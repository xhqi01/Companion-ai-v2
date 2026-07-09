import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret_at_least_32_characters_long_xx";

const { parseJson } = await import("./llm.js");

describe("parseJson LLM输出解析（persona场景）", () => {
  it("解析特征提取的标准输出", () => {
    const raw = '{"facts":["她喜欢猫"],"style":["语气温柔"],"phrases":[],"patterns":[]}';
    const result = parseJson(raw);
    assert.deepEqual(result.facts, ["她喜欢猫"]);
    assert.deepEqual(result.style, ["语气温柔"]);
  });

  it("去掉 ```json 代码块包裹", () => {
    const raw = "```json\n{\"facts\":[\"测试\"]}\n```";
    assert.deepEqual(parseJson(raw).facts, ["测试"]);
  });
});
