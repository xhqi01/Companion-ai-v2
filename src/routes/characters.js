import { Router } from "express";
import { q } from "../db.js";
import { decrypt } from "../lib/crypto.js";

const r = Router();

// 创建角色: { name, language } — 归属当前登录用户
r.post("/", async (req, res) => {
  const { name, language = "中文" } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const { rows } = await q(
    "INSERT INTO characters (user_id, name, language) VALUES ($1, $2, $3) RETURNING id, name, language, created_at",
    [req.userId, name.trim(), String(language).trim()]
  );
  res.json(rows[0]);
});

// 只列出自己的角色
r.get("/", async (req, res) => {
  const { rows } = await q(
    "SELECT id, name, language, msg_count, created_at FROM characters WHERE user_id=$1 ORDER BY created_at DESC",
    [req.userId]
  );
  res.json(rows);
});

r.get("/:id", async (req, res) => {
  const { rows } = await q(
    "SELECT id, name, language, persona_model, memory, msg_count, created_at FROM characters WHERE id=$1 AND user_id=$2",
    [req.params.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

r.patch("/:id", async (req, res) => {
  const { name, language } = req.body || {};
  const { rows } = await q(
    `UPDATE characters SET
       name = COALESCE($3, name),
       language = COALESCE($4, language)
     WHERE id=$1 AND user_id=$2 RETURNING id, name, language`,
    [req.params.id, req.userId, name?.trim() || null, language?.trim() || null]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// 导出角色: 人设模型 + 对话记忆 + 档案（?full=1 时附带解密后的文本档案原文）
// GET /api/characters/:id/export        → 元数据 + persona_model + memory + 档案清单
// GET /api/characters/:id/export?full=1 → 额外包含文本档案的解密原文（图片仅含元数据，避免base64撑爆文件）
r.get("/:id/export", async (req, res) => {
  const { rows } = await q(
    "SELECT id, name, language, persona_model, memory, msg_count, created_at FROM characters WHERE id=$1 AND user_id=$2",
    [req.params.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  const c = rows[0];

  const full = req.query.full === "1" || req.query.full === "true";
  const { rows: aRows } = await q(
    "SELECT id, kind, label, media_type, status, features, content_enc, created_at FROM archives WHERE character_id=$1 ORDER BY created_at ASC",
    [c.id]
  );
  const archives = aRows.map((a) => {
    const base = { id: a.id, kind: a.kind, label: a.label, mediaType: a.media_type, status: a.status, features: a.features, createdAt: a.created_at };
    if (full && a.kind === "text") {
      try { base.content = decrypt(a.content_enc); } catch { base.content = null; base.contentError = "decrypt failed"; }
    }
    return base;
  });

  const payload = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    character: { name: c.name, language: c.language, msgCount: c.msg_count, createdAt: c.created_at },
    personaModel: c.persona_model,
    memory: c.memory,
    archives,
  };

  const safeName = c.name.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "character";
  res.setHeader("Content-Disposition", `attachment; filename="companion-${safeName}-export.json"`);
  res.json(payload);
});

r.delete("/:id", async (req, res) => {
  await q("DELETE FROM characters WHERE id=$1 AND user_id=$2", [req.params.id, req.userId]);
  res.json({ ok: true });
});

export default r;
