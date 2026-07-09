import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret_at_least_32_characters_long_xx";

const { parseJson, estimateTokens } = await import("./llm.js");

describe("parseJson 健壮解析", () => {
  it("解析干净的 JSON", () => {
    assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  });

  it("去掉 ```json 代码块", () => {
    assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  });

  it("LLM 前后带解释文字时仍能提取 JSON（升级后的新能力）", () => {
    const raw = '好的，以下是提取结果：{"facts":["测试"],"style":[]} 希望有帮助！';
    const result = parseJson(raw);
    assert.deepEqual(result.facts, ["测试"]);
  });

  it("提取 JSON 数组", () => {
    const raw = "结果: [1,2,3] 完毕";
    assert.deepEqual(parseJson(raw), [1, 2, 3]);
  });

  it("完全不含 JSON 时抛错并附带原始输出", () => {
    try {
      parseJson("这里没有任何JSON");
      assert.fail("应该抛错");
    } catch (e) {
      assert.ok(e.message.includes("不是有效JSON"));
      assert.ok(e.rawOutput);
    }
  });
});

describe("estimateTokens", () => {
  it("估算为字符数的一半（保守值）", () => {
    assert.equal(estimateTokens("12345678"), 4);
  });
  it("空字符串为 0", () => {
    assert.equal(estimateTokens(""), 0);
  });
});
