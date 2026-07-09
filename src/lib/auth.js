// 用户系统: 注册/登录 (bcrypt + JWT)
// 鉴权双模式:
//   1. httpOnly cookie (浏览器默认, 防XSS窃取)
//   2. Authorization: Bearer (API客户端/脚本)
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { q } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET 必须设置且至少32字符。生成: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"");
}

const TOKEN_TTL = process.env.TOKEN_TTL || "7d";
const COOKIE_NAME = "cp_session";
const IS_PROD = process.env.NODE_ENV === "production";

export const authRouter = Router();

const issueToken = (userId) => jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,                      // JS 无法读取 → 防 XSS 窃取
    secure: IS_PROD,                     // 生产环境仅 HTTPS
    sameSite: IS_PROD ? "none" : "lax",  // 跨域部署(前后端不同域)需要 none
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

/* ---------- POST /api/auth/register ---------- */
authRouter.post("/register", async (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password || "";
  if (!validEmail(email)) return res.status(400).json({ error: "invalid email" });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await q(
      "INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email",
      [email, hash]
    );
    const token = issueToken(rows[0].id);
    setSessionCookie(res, token);
    res.json({ token, user: rows[0] }); // token 仍返回, 供非浏览器客户端使用
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "email already registered" });
    throw e;
  }
});

/* ---------- POST /api/auth/login ---------- */
authRouter.post("/login", async (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password || "";
  const { rows } = await q("SELECT id, email, password_hash FROM users WHERE email=$1", [email]);
  // 统一报错文案，不暴露"邮箱是否存在"
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: "invalid email or password" });
  }
  const token = issueToken(rows[0].id);
  setSessionCookie(res, token);
  res.json({ token, user: { id: rows[0].id, email: rows[0].email } });
});

/* ---------- POST /api/auth/logout ---------- */
authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? "none" : "lax" });
  res.json({ ok: true });
});

/* ---------- GET /api/auth/me  会话检查 ---------- */
authRouter.get("/me", requireAuth, async (req, res) => {
  const { rows } = await q("SELECT id, email, created_at FROM users WHERE id=$1", [req.userId]);
  if (!rows[0]) return res.status(401).json({ error: "user not found" });
  res.json(rows[0]);
});

/* ---------- 鉴权中间件: cookie 优先, Bearer 兜底 ---------- */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  const token = req.cookies?.[COOKIE_NAME] || bearer;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: "invalid or expired token" });
  }
}

/* ---------- 所有权中间件: :characterId 必须属于当前用户 ---------- */
export async function requireOwnership(req, res, next) {
  const { rows } = await q(
    "SELECT id FROM characters WHERE id=$1 AND user_id=$2",
    [req.params.characterId, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" }); // 404而非403，不暴露资源存在性
  next();
}
