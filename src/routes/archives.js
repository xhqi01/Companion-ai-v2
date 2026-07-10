import { Router } from "express";
import { q } from "../db.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { embed, chunkText, toVectorLiteral } from "../lib/embeddings.js";
import { chat, parseJson } from "../lib/llm.js";
import { extractFeatures, aggregateModel } from "../lib/persona.js";
import { validateFeatures } from "../lib/validate.js";
import { enqueue, enqueueJob, registerHandler, isBusy } from "../lib/jobs.js";

const r = Router({ mergeParams: true });

/* ---------- 持久化任务: 处理单个档案 ----------
   payload 只存 { characterId, archiveId, kindOverride? }, 内容从档案表现读,
   保证 job 记录轻量、且重启后能凭 archiveId 完整重跑(幂等)。 */
registerHandler("process_archive", async ({ characterId, archiveId, kindOverride, mode = "fast" }) => {
  const { rows: cRows } = await q("SELECT name FROM characters WHERE id=$1", [characterId]);
  if (!cRows[0]) return; // 角色已删除, 静默跳过
  const { rows: aRows } = await q("SELECT kind, content_enc, media_type FROM archives WHERE id=$1", [archiveId]);
  if (!aRows[0]) return; // 档案已删除
  const a = aRows[0];
  const kind = kindOverride || a.kind;
  const content = decrypt(a.content_enc); // image 为原始 base64, 其余为文本
  try {
    await processArchive(characterId, cRows[0].name, archiveId, kind, content, a.media_type, mode);
    await q("UPDATE archives SET status='done', updated_at=now() WHERE id=$1", [archiveId]);
  } catch (e) {
    await q("UPDATE archives SET status='error', updated_at=now() WHERE id=$1", [archiveId]);
    throw e; // 让 job 记录也置为 error, 供恢复/排查
  }
});

/* ---------- 内部: 文本 → 分块 → embedding → 批量入库 ---------- */
async function indexChunks(characterId, archiveId, text) {
  const chunks = chunkText(text);
  if (!chunks.length) return 0;
  const vectors = await embed(chunks); // 内部已按批次请求
  // 单条SQL批量INSERT, 而非N次往返
  const values = [];
  const params = [];
  chunks.forEach((chunk, i) => {
    const base = i * 4;
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4}::vector)`);
    params.push(characterId, archiveId, encrypt(chunk), toVectorLiteral(vectors[i]));
  });
  await q(
    `INSERT INTO chunks (character_id, archive_id, content_enc, embedding) VALUES ${values.join(",")}`,
    params
  );
  return chunks.length;
}

/* ---------- 图片 → 客观文字转录（供向量检索用） ----------
   关键改动: 不再只返回一段纯文本，而是让视觉模型同时自评转录质量。
   图片转录比文字档案更容易失真(误读手写体/表情包语境/分不清发送方)，
   这些错误一旦被提取进 persona_model 就会被“固化”。所以在源头拿到:
     - transcript: 逐字转录(标注说话方)
     - confidence: 模型对本次转录准确度的自评 0~1
     - ambiguities: 拿不准的地方(看不清/分不清是谁说的)
   低置信度或有歧义 → 下游标记 quality_issue，供用户复核，而不是默默固化。 */
async function imageToText(mediaType, data) {
  const sys = `你是数据转录引擎，只输出JSON，不输出任何其他文字或markdown代码块。
把图片内容客观转录：聊天截图逐字转录对话并标注说话方；其他图片客观描述可见信息。不加主观评价。
同时诚实自评转录质量。
返回: {"transcript":"逐字转录文本","confidence":0到1的小数,"ambiguities":["拿不准的点，如看不清/分不清发送方"]}
confidence 打分参考: 文字清晰且发送方明确→0.9+；有模糊或需猜测发送方→0.5~0.7；大量看不清→0.3以下。`;
  const raw = await chat(
    sys,
    [{ role: "user", content: [
      { type: "image", mediaType, data },
      { type: "text", text: "转录这张图片并自评质量，只返回JSON。" },
    ] }],
    1500
  );
  try {
    const p = parseJson(raw);
    return {
      transcript: String(p.transcript || "").trim(),
      confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : null,
      ambiguities: Array.isArray(p.ambiguities) ? p.ambiguities.slice(0, 10).map(String) : [],
    };
  } catch {
    // 模型没按JSON返回时兜底: 整段当转录，置信度未知
    return { transcript: String(raw).trim(), confidence: null, ambiguities: [] };
  }
}

// 低于此置信度的图片转录会被标记待复核
const TRANSCRIPT_MIN_CONFIDENCE = parseFloat(process.env.TRANSCRIPT_MIN_CONFIDENCE ?? "0.6");

/* ---------- 内部: 处理单个档案（提取特征缓存 + 向量索引） ---------- */
async function processArchive(characterId, characterName, archiveId, kind, content, mediaType, mode = "fast") {
  let textForIndex;
  let features;
  let transcriptMeta = null;
  const isImage = kind === "image";
  if (isImage) {
    const t = await imageToText(mediaType, content);
    textForIndex = t.transcript;
    transcriptMeta = { confidence: t.confidence, ambiguities: t.ambiguities };
    features = await extractFeatures(characterName, { data: content, mediaType }, true, mode);
  } else {
    textForIndex = content;
    features = await extractFeatures(characterName, content, false, mode);
  }
  // 提取质量验证（纯程序，零额外API）: 幻觉/冗余/空/过度提取
  const issues = validateFeatures(features, textForIndex, isImage);
  // 图片转录置信度: 低置信或有歧义 → 追加质量问题, 供前端提示用户复核这条图片档案
  if (isImage && transcriptMeta) {
    if (transcriptMeta.confidence != null && transcriptMeta.confidence < TRANSCRIPT_MIN_CONFIDENCE) {
      issues.push({ type: "low_transcription_confidence", confidence: transcriptMeta.confidence });
    }
    if (transcriptMeta.ambiguities.length) {
      issues.push({ type: "transcription_ambiguity", notes: transcriptMeta.ambiguities });
    }
  }
  if (issues.length) console.warn(`[persona] archive=${archiveId} 提取质量问题:`, issues.map((i) => i.type).join(", "));
  await q("UPDATE archives SET features=$2, quality_issues=$3, transcript_meta=$4 WHERE id=$1",
    [archiveId, JSON.stringify(features), JSON.stringify(issues), transcriptMeta ? JSON.stringify(transcriptMeta) : null]);
  await indexChunks(characterId, archiveId, textForIndex);
  await aggregateModel(characterId); // 纯DB聚合，零API成本
}

/* ---------- 持久化任务: 深度重建整个角色 ---------- */
registerHandler("rebuild", async ({ characterId }) => {
  const { rows: cRows } = await q("SELECT name FROM characters WHERE id=$1", [characterId]);
  if (!cRows[0]) return;
  const { rows: archives } = await q(
    "SELECT id, kind, content_enc, media_type FROM archives WHERE character_id=$1 AND status != 'pending_transcript' ORDER BY created_at ASC",
    [characterId]
  );
  for (const a of archives) {
    const content = decrypt(a.content_enc);
    if (!content.trim()) continue;
    try {
      await q("UPDATE archives SET status='processing', updated_at=now() WHERE id=$1", [a.id]);
      await q("DELETE FROM chunks WHERE archive_id=$1", [a.id]);
      await processArchive(characterId, cRows[0].name, a.id, a.kind, content, a.media_type, "deep");
      await q("UPDATE archives SET status='done', updated_at=now() WHERE id=$1", [a.id]);
    } catch (e) {
      console.error(`[rebuild] archive=${a.id} 失败:`, e.message);
      await q("UPDATE archives SET status='error', updated_at=now() WHERE id=$1", [a.id]);
    }
  }
  await aggregateModel(characterId);
});

/* ---------- 排队处理档案(持久化, 重启不丢) ---------- */
function scheduleProcessing(characterId, archiveId, kindOverride, mode = "fast") {
  return enqueueJob(characterId, "process_archive", { characterId, archiveId, kindOverride, mode });
}

/* ---------- POST /  喂数据 → 立刻返回, 后台异步处理 ---------- */
// body: { kind, label?, content, mediaType? }
// 返回 status=processing, 前端轮询 GET / 直到 done|error
r.post("/", async (req, res) => {
  const characterId = req.params.characterId;
  const { kind, label = "", content = "", mediaType = "", mode = "fast" } = req.body || {};
  if (!["text", "image", "av"].includes(kind)) return res.status(400).json({ error: "kind must be text|image|av" });
  if (kind !== "av" && !content.trim()) return res.status(400).json({ error: "content required" });
  const extractMode = mode === "deep" ? "deep" : "fast";

  const status = kind === "av" && !content.trim() ? "pending_transcript" : "processing";
  const { rows } = await q(
    `INSERT INTO archives (character_id, kind, label, content_enc, media_type, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, kind, label, status, created_at`,
    [characterId, kind, label || kind, encrypt(content), mediaType, status]
  );
  const archive = rows[0];

  // 关键改动: 不再await处理过程, 立刻返回
  if (status === "processing") {
    scheduleProcessing(characterId, archive.id, kind, extractMode);
  }
  res.status(202).json(archive); // 202 Accepted: 已接受, 处理中
});

/* ---------- GET / 档案列表（前端轮询状态用, 含质量标记供提示复核） ---------- */
r.get("/", async (req, res) => {
  const { rows } = await q(
    "SELECT id, kind, label, media_type, status, quality_issues, created_at, updated_at FROM archives WHERE character_id=$1 ORDER BY created_at DESC",
    [req.params.characterId]
  );
  res.json(rows);
});

/* ---------- GET /:archiveId 解密查看原文（含转录自评与质量标记） ---------- */
r.get("/:archiveId", async (req, res) => {
  const { rows } = await q("SELECT * FROM archives WHERE id=$1 AND character_id=$2", [req.params.archiveId, req.params.characterId]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  const a = rows[0];
  res.json({
    id: a.id, kind: a.kind, label: a.label, mediaType: a.media_type, status: a.status,
    content: decrypt(a.content_enc),
    qualityIssues: a.quality_issues || [],
    transcriptMeta: a.transcript_meta || null, // 图片档案: { confidence, ambiguities }
    createdAt: a.created_at,
  });
});

/* ---------- PUT /:archiveId 编辑 → 只重算这一个档案 + 重新聚合（增量, 异步） ---------- */
r.put("/:archiveId", async (req, res) => {
  const { characterId, archiveId } = req.params;
  const { label, content } = req.body || {};
  const { rows } = await q("SELECT * FROM archives WHERE id=$1 AND character_id=$2", [archiveId, characterId]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  const a = rows[0];

  const newContent = content ?? decrypt(a.content_enc);
  const pending = a.kind === "av" && !newContent.trim();
  await q("UPDATE archives SET label=COALESCE($2,label), content_enc=$3, status=$4, features=NULL, updated_at=now() WHERE id=$1",
    [archiveId, label || null, encrypt(newContent), pending ? "pending_transcript" : "processing"]);
  await q("DELETE FROM chunks WHERE archive_id=$1", [archiveId]);

  if (!pending) {
    // av档案编辑后按text处理(转写文本); image档案只能改label
    const kindOverride = a.kind === "av" ? "text" : a.kind;
    scheduleProcessing(characterId, archiveId, kindOverride);
  } else {
    enqueue(characterId, () => aggregateModel(characterId));
  }
  res.status(202).json({ ok: true, status: pending ? "pending_transcript" : "processing" });
});

/* ---------- DELETE /:archiveId 删除 → 重新聚合（零API成本） ---------- */
r.delete("/:archiveId", async (req, res) => {
  const { characterId, archiveId } = req.params;
  await q("DELETE FROM archives WHERE id=$1 AND character_id=$2", [archiveId, characterId]);
  enqueue(characterId, () => aggregateModel(characterId));
  res.json({ ok: true });
});

/* ---------- POST /rebuild 深度重建（带防并发锁, 持久化重启不丢） ---------- */
r.post("/rebuild", async (req, res) => {
  const characterId = req.params.characterId;
  // 防并发: 该角色有任务在跑时拒绝(含内存队列 + DB 里未完成的 job)
  if (await isBusy(characterId)) {
    return res.status(409).json({ error: "该角色有任务正在处理中，请稍后再试" });
  }

  const { rows } = await q(
    "SELECT id FROM archives WHERE character_id=$1 AND status != 'pending_transcript'",
    [characterId]
  );
  if (!rows.length) return res.status(400).json({ error: "没有可重建的档案" });

  // 整个重建作为一条持久化 job 入队, 进程重启后自动续跑
  await enqueueJob(characterId, "rebuild", { characterId });

  res.status(202).json({ ok: true, queued: rows.length, message: "重建已开始，请轮询档案列表查看进度" });
});

export default r;
