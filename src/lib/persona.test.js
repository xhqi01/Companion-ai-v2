import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret_at_least_32_characters_long_xx";

const { parseJson } = await import("./llm.js");
const { validateFeatures } = await import("./validate.js");

describe("parseJson LLM输出解析（persona场景）", () => {
  it("解析特征提取的标准输出", () => {
    const raw = '{"facts":["她喜欢猫"],"style":["语气温柔"],"phrases":[],"patterns":[]}';
    const result = parseJson(raw);
    assert.deepEqual(result.facts, ["她喜欢猫"]);
  });
  it("去掉 ```json 代码块包裹", () => {
    assert.deepEqual(parseJson("```json\n{\"facts\":[\"测试\"]}\n```").facts, ["测试"]);
  });
});

describe("validateFeatures 提取质量验证", () => {
  const raw = "他：诶 你还没睡\n我：刚睡着要\n他：那就好 我还担心来着\n我：担心我干嘛\n他：就是 担心啊";

  it("干净的提取无问题", () => {
    const features = {
      facts: ["深夜聊天"], style: ["句子很短"],
      phrases: ["诶 你还没睡", "那就好 我还担心来着"], patterns: ["主动关心"],
    };
    const issues = validateFeatures(features, raw, false);
    assert.equal(issues.length, 0);
  });

  it("检测幻觉phrase（原文里没有的句子）", () => {
    const features = { facts: [], style: [], phrases: ["我爱你一辈子"], patterns: [] };
    const issues = validateFeatures(features, raw, false);
    assert.ok(issues.some((i) => i.type === "phantom_phrase"));
  });

  it("检测过长的style描述", () => {
    const features = { facts: [], style: ["这个人说话的时候总是习惯性地使用非常多的语气词并且句子结构往往很复杂冗长啰嗦得让人抓不住重点"], phrases: [], patterns: [] };
    const issues = validateFeatures(features, raw, false);
    assert.ok(issues.some((i) => i.type === "style_too_verbose"));
  });

  it("检测空提取", () => {
    const features = { facts: [], style: [], phrases: [], patterns: [] };
    const issues = validateFeatures(features, raw, false);
    assert.ok(issues.some((i) => i.type === "empty_extraction"));
  });

  it("检测过度提取（特征数远超数据量）", () => {
    const shortText = "他：嗯";
    const features = {
      facts: ["a", "b", "c", "d", "e", "f"], style: ["g", "h", "i", "j", "k"],
      phrases: ["嗯"], patterns: ["l", "m", "n", "o", "p"],
    };
    const issues = validateFeatures(features, shortText, false);
    assert.ok(issues.some((i) => i.type === "over_extraction"));
  });

  it("图片档案放宽phrase比对（不误报幻觉）", () => {
    const features = { facts: [], style: ["简短"], phrases: ["转录可能不精确的句子"], patterns: [] };
    const issues = validateFeatures(features, "转录文本", true);
    assert.ok(!issues.some((i) => i.type === "phantom_phrase"));
  });
});
