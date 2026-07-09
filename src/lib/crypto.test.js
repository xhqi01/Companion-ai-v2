import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// 测试前注入环境变量（不依赖 .env 文件）
process.env.ENCRYPTION_KEY = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long_xx";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://skip";

const { encrypt, decrypt } = await import("./crypto.js");

describe("AES-256-GCM 加密层", () => {
  it("加密后可以正确解密", () => {
    const original = "你好，世界！Hello World 123";
    const ciphertext = encrypt(original);
    assert.equal(decrypt(ciphertext), original);
  });

  it("相同明文每次加密结果不同（IV随机）", () => {
    const text = "same input";
    const a = encrypt(text);
    const b = encrypt(text);
    assert.notEqual(a, b);
    // 但解密结果相同
    assert.equal(decrypt(a), decrypt(b));
  });

  it("加密结果格式为 iv:tag:ciphertext", () => {
    const result = encrypt("test");
    const parts = result.split(":");
    assert.equal(parts.length, 3);
    // 每段都是有效的 base64
    for (const part of parts) {
      assert.ok(Buffer.from(part, "base64").length > 0);
    }
  });

  it("篡改密文后解密会抛错", () => {
    const ciphertext = encrypt("sensitive data");
    const tampered = ciphertext.slice(0, -4) + "XXXX";
    assert.throws(() => decrypt(tampered));
  });

  it("空字符串也能加解密", () => {
    const result = encrypt("");
    assert.equal(decrypt(result), "");
  });
});
