import "dotenv/config";
import fs from "fs";
import path from "path";
import url from "url";
import { pool } from "./db.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");

// 幂等迁移: 全部 IF NOT EXISTS / IF NOT EXISTS，可重复跑
const migrations = [
  // v2.3 原有
  `ALTER TABLE archives ADD COLUMN IF NOT EXISTS quality_issues JSONB DEFAULT '[]'::jsonb`,
  // v2.4 新增 ─────────────────────────────────────────────────
  // #5 用户健康度守护: 记录上次落地提示轮数
  `ALTER TABLE characters ADD COLUMN IF NOT EXISTS last_grounded_at INTEGER NOT NULL DEFAULT 0`,
  // #4 图片转录置信度存档
  `ALTER TABLE archives ADD COLUMN IF NOT EXISTS transcript_meta JSONB`,
  // #3 持久化后台任务表
  `CREATE TABLE IF NOT EXISTS jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,
    payload       JSONB NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'queued',
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status) WHERE status IN ('queued','running')`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_character ON jobs(character_id)`,
];

const run = async () => {
  await pool.query(sql);
  console.log("✓ schema applied");
  for (const m of migrations) {
    await pool.query(m);
    process.stdout.write(".");
  }
  console.log(`\n✓ ${migrations.length} migration(s) applied`);
  await pool.end();
};
run().catch((e) => { console.error(e); process.exit(1); });
