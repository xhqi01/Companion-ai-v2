// ============================================================
// Shamir's Secret Sharing (SSS) over GF(2^8)
//   用途: 把 ENCRYPTION_KEY 拆成 N 份, 任意 T 份即可重建。
//   解决“密钥单点丢失 = 全部数据永久不可恢复”的运营风险:
//     - 3-of-5: 分给 5 个信任方/设备, 任意 3 份可恢复, 丢 2 份仍安全
//     - 单份泄露不足以还原密钥(信息论安全, 少于阈值份数时零信息)
//   纯 JS, 无第三方依赖。运行时加解密逻辑完全不变——这只是离线备份工具。
//
//   ⚠️ 这不改变系统的加密方式, 只提供一种更抗灾的密钥保管方案。
//   仍然: 至少留一份完整密钥在密码管理器里, SSS 是额外保险而非替代。
// ============================================================
import crypto from "crypto";

// ---- GF(256) 运算, 用 AES 的既约多项式 0x11b ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const gfDiv = (a, b) => {
  if (b === 0) throw new Error("GF division by zero");
  return a === 0 ? 0 : EXP[(LOG[a] - LOG[b] + 255) % 255];
};

// 在 x 处求多项式值(系数为 GF(256) 字节, coeffs[0] 为常数项=秘密字节)
function evalPoly(coeffs, x) {
  let result = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) result = gfMul(result, x) ^ coeffs[i];
  return result;
}

/**
 * 拆分单个字节为 n 份 (阈值 t)。返回 [[x, y], ...]
 */
function splitByte(secretByte, n, t) {
  const coeffs = new Uint8Array(t);
  coeffs[0] = secretByte;
  const rand = crypto.randomBytes(t - 1);
  for (let i = 1; i < t; i++) coeffs[i] = rand[i - 1];
  const shares = [];
  for (let x = 1; x <= n; x++) shares.push([x, evalPoly(coeffs, x)]);
  return shares;
}

/**
 * 拉格朗日插值在 x=0 处还原秘密字节。points: [[x,y], ...] 至少 t 个
 */
function recoverByte(points) {
  let secret = 0;
  for (let i = 0; i < points.length; i++) {
    const [xi, yi] = points[i];
    let num = 1, den = 1;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const [xj] = points[j];
      num = gfMul(num, xj);
      den = gfMul(den, xi ^ xj);
    }
    secret ^= gfMul(yi, gfDiv(num, den));
  }
  return secret;
}

/**
 * 把 hex 密钥拆成 n 份分享串。
 * @param {string} hexSecret 64位hex的 ENCRYPTION_KEY
 * @param {number} n 总份数
 * @param {number} t 恢复阈值 (t<=n)
 * @returns {string[]} 每份形如 "01-3f9a...", 前缀是 share 序号(hex), 后面是各字节的 y 值
 */
export function splitKey(hexSecret, n, t) {
  if (!/^[0-9a-fA-F]{64}$/.test(hexSecret)) throw new Error("ENCRYPTION_KEY 必须是64位hex");
  if (t < 2 || t > n || n > 255) throw new Error("需满足 2<=t<=n<=255");
  const secret = Buffer.from(hexSecret, "hex"); // 32 字节
  // 每个字节独立拆分, 同一 share 序号 x 的所有字节拼成该份
  const yByShare = Array.from({ length: n }, () => []);
  for (const byte of secret) {
    const shares = splitByte(byte, n, t);
    shares.forEach(([x, y], idx) => { yByShare[idx].push(y); if (yByShare[idx].x == null) yByShare[idx].x = x; });
  }
  return yByShare.map((ys, idx) => {
    const x = idx + 1;
    const hex = Buffer.from(ys).toString("hex");
    return `${x.toString(16).padStart(2, "0")}-${hex}`;
  });
}

/**
 * 从若干份分享串重建 hex 密钥。
 * @param {string[]} shareStrings 至少 t 份, 形如 "01-3f9a..."
 * @returns {string} 64位hex 密钥
 */
export function combineKey(shareStrings) {
  if (!Array.isArray(shareStrings) || shareStrings.length < 2) throw new Error("至少需要 2 份分享");
  const parsed = shareStrings.map((s) => {
    const [xHex, yHex] = String(s).trim().split("-");
    if (!xHex || !yHex) throw new Error(`分享格式错误: ${s}`);
    return { x: parseInt(xHex, 16), y: Buffer.from(yHex, "hex") };
  });
  const len = parsed[0].y.length;
  if (!parsed.every((p) => p.y.length === len)) throw new Error("各份长度不一致, 可能来自不同密钥");
  const out = Buffer.alloc(len);
  for (let b = 0; b < len; b++) {
    const points = parsed.map((p) => [p.x, p.y[b]]);
    out[b] = recoverByte(points);
  }
  return out.toString("hex");
}
