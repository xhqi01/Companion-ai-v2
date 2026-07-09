// AES-256-GCM 加密层 — 所有原始数据（档案/分块/消息）加密落库
// ENCRYPTION_KEY: 64位hex字符串（32字节）。生成: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
import crypto from "crypto";

const KEY = process.env.ENCRYPTION_KEY;
if (!KEY || KEY.length !== 64) {
  throw new Error("ENCRYPTION_KEY 必须是64位hex（32字节）。生成: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
}
const key = Buffer.from(KEY, "hex");

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
