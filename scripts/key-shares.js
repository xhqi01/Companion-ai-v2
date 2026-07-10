#!/usr/bin/env node
// ============================================================
// 密钥分片 CLI — 把 ENCRYPTION_KEY 拆成多份备份 / 从多份重建
//
// 拆分(默认 3-of-5, 读取 .env 里的 ENCRYPTION_KEY):
//   node scripts/key-shares.js split
//   node scripts/key-shares.js split --n 5 --t 3
//   node scripts/key-shares.js split --key <64位hex> --n 4 --t 2
//
// 重建(把任意 t 份粘进来, 空格或换行分隔):
//   node scripts/key-shares.js combine 01-.... 03-.... 05-....
//
// 把每一份分别交给不同的信任方/设备/密码库。少于 t 份的人拼不出密钥。
// ============================================================
import "dotenv/config";
import { splitKey, combineKey } from "../src/lib/keyshares.js";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

if (cmd === "split") {
  const key = flag("key", process.env.ENCRYPTION_KEY);
  const n = parseInt(flag("n", "5"));
  const t = parseInt(flag("t", "3"));
  if (!key) { console.error("找不到密钥: 设置 .env 的 ENCRYPTION_KEY 或用 --key 传入"); process.exit(1); }
  const shares = splitKey(key, n, t);
  console.log(`\n已把密钥拆成 ${n} 份, 任意 ${t} 份可重建。分别保管到不同地方:\n`);
  shares.forEach((s, i) => console.log(`  份 #${i + 1}:  ${s}`));
  console.log(`\n⚠️ 单独一份无法还原密钥。恢复时: node scripts/key-shares.js combine <${t}份>\n`);
} else if (cmd === "combine") {
  const shares = args.slice(1).filter((a) => a.includes("-"));
  if (shares.length < 2) { console.error("请在命令后粘贴至少 2 份分享(空格分隔)"); process.exit(1); }
  try {
    const key = combineKey(shares);
    console.log(`\n重建出的 ENCRYPTION_KEY:\n\n  ${key}\n\n把它填回 .env 与部署平台的环境变量即可。\n`);
  } catch (e) {
    console.error("重建失败:", e.message);
    process.exit(1);
  }
} else {
  console.log("用法:\n  node scripts/key-shares.js split [--n 5 --t 3] [--key <hex>]\n  node scripts/key-shares.js combine <share1> <share2> ...");
}
