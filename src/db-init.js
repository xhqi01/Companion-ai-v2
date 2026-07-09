import "dotenv/config";
import fs from "fs";
import path from "path";
import url from "url";
import { pool } from "./db.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");

const run = async () => {
  await pool.query(sql);
  console.log("✓ schema applied");
  await pool.end();
};
run().catch((e) => { console.error(e); process.exit(1); });
