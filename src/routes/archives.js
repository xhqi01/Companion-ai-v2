import { Router } from "express";
import { q } from "../db.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { embed, chunkText, toVectorLiteral } from "../lib/embeddings.js";
import { chat } from "../lib/llm.js";
import { extractFeatures, aggregateModel } from "../lib/persona.js";
import { validateFeatures } from "../lib/validate.js";
import { enqueue, isBusy } from "../lib/jobs.js";

const r = Router({ mergeParams: true });

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

/* ---------- 图片 → 客观文字转录（供向量检索用） ---------- */
async function imageToText(mediaType, data) {
  return chat(
    "你是数据转录引擎。把图片里的内容客观转录成文字：聊天截图逐字转录对话（标注说话方），其他图片客观描述可见信息。不加任何主观评价。",
    [{ role: "user", content: [
      { type: "image", mediaType, data },
      { type: "text", text: "转录这张图片的内容。" },
    ] }],
    1500
  );
}

/* ---------- 内部: 处理单个档案（提取特征缓存 + 向量索引） ---------- */
async function processArchive(characterId, characterName, archiveId, kind, content, mediaType, mode = "fast") {
  let textForIndex;
  let features;
  const isImage = kind === "image";
  if (isImage) {
    textForIndex = await imageToText(mediaType, content);
    features = await extractFeatures(characterName, { data: content, mediaType }, true, mode);
  } else {
    textForIndex = content;
    features = await extractFeatures(characterName, content, false, mode);
  }
  // 提取质量验证（纯程序，零额外API）: 幻觉/冗余/空/过度提取
  const issues = validateFeatures(features, textForIndex, isImage);
  if (issues.length) console.warn(`[persona] archive=${archiveId} 提取质量问题:`, issues.map((i) => i.type).join(", "));
  await q("UPDATE archives SET features=$2, quality_issues=$3 WHERE id=$1",
    [archiveId, JSON.stringify(features), JSON.stringify(issues)]);
  await indexChunks(characterId, archiveId, textForIndex);
  await aggregateModel(characterId); // 纯DB聚合，零API成本
}

/* ---------- 后台任务: 处理并更新状态 ---------- */
function scheduleProcessing(characterId, archiveId, kind, content, mediaType, mode = "fast") {
  enqueue(characterId, async () => {
    try {
      const { rows: cRows } = await q("SELECT name FROM characters WHERE id=$1", [characterId]);
      if (!cRows[0]) return; // 角色已被删除
      await processArchive(characterId, cRows[0].name, archiveId, kind, content, mediaType, mode);
      await q("UPDATE archives SET status='done', updated_at=now() WHERE id=$1", [archiveId]);
    } catch (e) {
      console.error(`[archives] 处理失败 archive=${archiveId}:`, e.message);
      await q("UPDATE archives SET status='error', updated_at=now() WHERE id=$1", [archiveId]);
    }
  });
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
    scheduleProcessing(characterId, archive.id, kind, content, mediaType, extractMode);
  }
  res.status(202).json(archive); // 202 Accepted: 已接受, 处理中
});

/* ---------- GET / 档案列表（前端轮询状态用） ---------- */
r.get("/", async (req, res) => {
  const { rows } = await q(
    "SELECT id, kind, label, media_type, status, created_at, updated_at FROM archives WHERE character_id=$1 ORDER BY created_at DESC",
    [req.params.characterId]
  );
  res.json(rows);
});

/* ---------- GET /:archiveId 解密查看原文 ---------- */
r.get("/:archiveId", async (req, res) => {
  const { rows } = await q("SELECT * FROM archives WHERE id=$1 AND character_id=$2", [req.params.archiveId, req.params.characterId]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  const a = rows[0];
  res.json({ id: a.id, kind: a.kind, label: a.label, mediaType: a.media_type, status: a.status, content: decrypt(a.content_enc), createdAt: a.created_at });
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
    const kind = a.kind === "av" ? "text" : a.kind;
    const payload = a.kind === "image" ? decrypt(a.content_enc) : newContent;
    scheduleProcessing(characterId, archiveId, kind, payload, a.media_type);
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

/* ---------- POST /rebuild 深度重建（带防并发锁） ---------- */
r.post("/rebuild", async (req, res) => {
  const characterId = req.params.characterId;
  // 防并发: 该角色有任务在跑时拒绝
  if (isBusy(characterId)) {
    return res.status(409).json({ error: "该角色有任务正在处理中，请稍后再试" });
  }

  const { rows } = await q(
    "SELECT id FROM archives WHERE character_id=$1 AND status != 'pending_transcript'",
    [characterId]
  );
  if (!rows.length) return res.status(400).json({ error: "没有可重建的档案" });

  // 全部档案入队后台处理
  enqueue(characterId, async () => {
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

  res.status(202).json({ ok: true, queued: rows.length, message: "重建已开始，请轮询档案列表查看进度" });
});

export default r;
