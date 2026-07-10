import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import charactersRouter from "./routes/characters.js";
import archivesRouter from "./routes/archives.js";
import chatRouter from "./routes/chat.js";
import { authRouter, requireAuth, requireOwnership } from "./lib/auth.js";
import { recoverStuckArchives, resumePendingJobs } from "./lib/jobs.js";
import { pool } from "./db.js";

const app = express();
app.set("trust proxy", 1); // Railway/Render 等反向代理后正确识别IP

/* ---------- 安全与基础中间件 ---------- */
app.use(helmet());
app.use(cookieParser());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()) || "http://localhost:5173",
  credentials: true, // httpOnly cookie 跨域必需
}));
app.use(express.json({ limit: "25mb" }));

/* ---------- 频率限制 ---------- */
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "too many attempts, try again later" } });

/* ---------- 路由 ---------- */
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1"); // 健康检查连带数据库连通性
    res.json({ ok: true, db: true });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
});

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/characters", requireAuth, charactersRouter);
app.use("/api/characters/:characterId/archives", requireAuth, requireOwnership, archivesRouter);
app.use("/api/characters/:characterId/chat", requireAuth, requireOwnership, chatRouter);

/* ---------- 统一错误处理 ---------- */
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

/* ---------- 启动 ---------- */
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, async () => {
  console.log(`companion-backend listening on :${PORT}`);
  try {
    await recoverStuckArchives();   // 清理无主的 processing 档案
    await resumePendingJobs();       // 重启后续跑上次未完成的持久化任务(handler 已随路由 import 注册)
  } catch (e) {
    console.error("启动恢复失败:", e.message);
  }
});

/* ---------- 优雅关闭 ---------- */
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`收到 ${sig}, 优雅关闭中...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref(); // 兜底强制退出
  });
}

export default app; // 供集成测试import
