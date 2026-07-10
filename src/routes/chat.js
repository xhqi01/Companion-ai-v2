import { Router } from "express";
import { q } from "../db.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { embed, toVectorLiteral } from "../lib/embeddings.js";
import { chat, parseJson, estimateTokens } from "../lib/llm.js";
import { EXTRACT_SYSTEM, memoryPrompt, buildSystemPrompt } from "../lib/persona.js";
import { resolveRetrievalParams } from "../lib/retrieval.js";
import { groundingNote } from "../lib/wellbeing.js";

const HISTORY_TOKEN_BUDGET = parseInt(process.env.HISTORY_TOKEN_BUDGET) || 4000; // 历史消息token预算
const r = Router({ mergeParams: true });

/* ---------- 历史消息按token预算截断（从最新往回取，超预算即停） ---------- */
function trimHistory(messages, budget) {
  const out = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i].content);
    if (used + cost > budget && out.length > 0) break;
    out.unshift(messages[i]);
    used += cost;
  }
  return out;
}

/* ---------- POST /  发消息（RAG核心流程） ---------- */
// body: { message }
r.post("/", async (req, res) => {
  const characterId = req.params.characterId;
  const message = (req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "message required" });
  if (message.length > 8000) return res.status(400).json({ error: "message too long (max 8000 chars)" });

  const { rows: cRows } = await q(
    "SELECT name, language, persona_model, memory, msg_count, last_grounded_at FROM characters WHERE id=$1",
    [characterId]
  );
  if (!cRows[0]) return res.status(404).json({ error: "character not found" });
  const c = cRows[0];

  try {
    // 1. 向量检索: 当前消息 → embedding → 语义最相关的历史片段
    //    检索参数按该角色的数据体量自适应(冷启动放宽/数据充裕收紧)
    let retrieved = [];
    let retrievalTier = "cold";
    try {
      const { rows: cntRows } = await q(
        "SELECT count(*)::int AS n FROM chunks WHERE character_id=$1",
        [characterId]
      );
      const { topK, minScore, tier } = resolveRetrievalParams(cntRows[0]?.n || 0);
      retrievalTier = tier;
      const [qVec] = await embed(message);
      const { rows: hits } = await q(
        `SELECT content_enc, 1 - (embedding <=> $2::vector) AS score
         FROM chunks WHERE character_id=$1
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [characterId, toVectorLiteral(qVec), topK]
      );
      retrieved = hits.filter((h) => h.score > minScore).map((h) => decrypt(h.content_enc));
    } catch (e) {
      console.error("retrieval failed (continuing without):", e.message);
    }

    // 2. 最近对话上下文: 取50条再按token预算截断, 防止超context window
    const { rows: mRows } = await q(
      "SELECT role, content_enc FROM messages WHERE character_id=$1 ORDER BY id DESC LIMIT 50",
      [characterId]
    );
    const rawHistory = mRows.reverse().map((m) => ({ role: m.role, content: decrypt(m.content_enc) }));
    const history = trimHistory(rawHistory, HISTORY_TOKEN_BUDGET);

    // 3. 组装 system prompt: 人设模型 + 检索片段 + 对话记忆 + 语言锁定
    let system = buildSystemPrompt(c.name, c.language, c.persona_model, c.memory, retrieved);

    // 3b. 用户健康度: 检测强依恋信号 → 少数时机让角色温柔落地一句“我是重建”
    const grounding = groundingNote({
      message,
      turnCount: c.msg_count,
      lastGroundedAt: c.last_grounded_at || 0,
    });
    if (grounding.inject) system += `\n${grounding.note}`;

    const reply = await chat(system, [...history, { role: "user", content: message }], 800);

    // 4. 消息加密落库
    await q("INSERT INTO messages (character_id, role, content_enc) VALUES ($1,'user',$2)", [characterId, encrypt(message)]);
    await q("INSERT INTO messages (character_id, role, content_enc) VALUES ($1,'assistant',$2)", [characterId, encrypt(reply)]);
    const newCount = c.msg_count + 1;
    if (grounding.inject) {
      await q("UPDATE characters SET msg_count=$2, last_grounded_at=$3 WHERE id=$1", [characterId, newCount, grounding.groundedAt]);
    } else {
      await q("UPDATE characters SET msg_count=$2 WHERE id=$1", [characterId, newCount]);
    }

    // 5. 每3轮后台提炼对话记忆（不阻塞响应）
    if (newCount % 3 === 0) updateMemory(characterId, c.name).catch((e) => console.error("memory update failed:", e.message));

    res.json({ reply, retrievedCount: retrieved.length, retrievalTier });
  } catch (e) {
    console.error("[chat]", e);
    res.status(500).json({ error: "对话生成失败，请重试" }); // 不向客户端泄露内部错误细节
  }
});

/* ---------- GET /history ---------- */
r.get("/history", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { rows } = await q(
    "SELECT id, role, content_enc, created_at FROM messages WHERE character_id=$1 ORDER BY id DESC LIMIT $2",
    [req.params.characterId, limit]
  );
  res.json(rows.reverse().map((m) => ({ id: m.id, role: m.role, content: decrypt(m.content_enc), createdAt: m.created_at })));
});

/* ---------- DELETE /history  清空对话（保留人设与档案） ---------- */
r.delete("/history", async (req, res) => {
  await q("DELETE FROM messages WHERE character_id=$1", [req.params.characterId]);
  await q(`UPDATE characters SET memory='{"facts":[],"patterns":[],"emotions":"","threads":[]}', msg_count=0 WHERE id=$1`, [req.params.characterId]);
  res.json({ ok: true });
});

/* ---------- 后台记忆提炼 ---------- */
async function updateMemory(characterId, name) {
  const { rows: mRows } = await q(
    "SELECT role, content_enc FROM messages WHERE character_id=$1 ORDER BY id DESC LIMIT 12",
    [characterId]
  );
  const transcript = mRows.reverse()
    .map((m) => `${m.role === "user" ? "用户" : name}: ${decrypt(m.content_enc)}`)
    .join("\n");
  const { rows: cRows } = await q("SELECT memory FROM characters WHERE id=$1", [characterId]);
  const raw = await chat(EXTRACT_SYSTEM, [{ role: "user", content: memoryPrompt(transcript, cRows[0].memory) }], 800);
  const parsed = parseJson(raw);
  const merged = {
    facts: parsed.facts || [],
    patterns: parsed.patterns || [],
    emotions: parsed.emotions || "",
    threads: parsed.threads || [],
  };
  await q("UPDATE characters SET memory=$2 WHERE id=$1", [characterId, JSON.stringify(merged)]);
}

export default r;
