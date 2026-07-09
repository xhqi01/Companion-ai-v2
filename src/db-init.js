import "dotenv/config";
import fs from "fs";
import path from "path";
import url from "url";
import { pool } from "./db.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");

// 幂等迁移: 给已存在的旧表补充新列（CREATE TABLE IF NOT EXISTS 不会改已有表结构）
const migrations = [
  `ALTER TABLE archives ADD COLUMN IF NOT EXISTS quality_issues JSONB DEFAULT '[]'::jsonb`,
];

const run = async () => {
  await pool.query(sql);
  console.log("✓ schema applied");
  for (const m of migrations) {
    await pool.query(m);
  }
  console.log(`✓ ${migrations.length} migration(s) applied`);
  await pool.end();
};
run().catch((e) => { console.error(e); process.exit(1); });
