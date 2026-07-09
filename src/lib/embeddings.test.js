import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkText, toVectorLiteral } from "./embeddings.js";

describe("chunkText 文本分块", () => {
  it("短文本返回单个分块", () => {
    const text = "这是一段超过十个字符的短文本内容，用于测试。";
    const chunks = chunkText(text, 500);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].includes("短文本内容"));
  });

  it("长文本按 maxLen 拆分", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `第${i + 1}行：${"内容".repeat(30)}`);
    const text = lines.join("\n");
    const chunks = chunkText(text, 120);
    assert.ok(chunks.length > 1, "应该被拆成多个分块");
  });

  it("过滤掉空行和纯空白行", () => {
    const text = "这是有实际内容的第一行文字\n\n   \n这是有实际内容的第二行文字";
    const chunks = chunkText(text, 500);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].includes("第一行文字"));
    assert.ok(chunks[0].includes("第二行文字"));
  });

  it("过短的内容（≤10字符）被过滤，返回空数组", () => {
    assert.deepEqual(chunkText("短", 500), []);
    assert.deepEqual(chunkText("十个字以内", 500), []);
  });

  it("分块之间有1行重叠（保持上下文连续）", () => {
    const lines = ["A".repeat(60), "B".repeat(60), "C".repeat(60)];
    const chunks = chunkText(lines.join("\n"), 100);
    assert.ok(chunks.length >= 2);
    // 第二个分块应以第一个分块的最后一行开头
    const lastLineOfFirst = chunks[0].split("\n").pop();
    assert.ok(chunks[1].startsWith(lastLineOfFirst));
  });
});

describe("toVectorLiteral", () => {
  it("正确格式化向量", () => {
    assert.equal(toVectorLiteral([0.1, 0.2, 0.3]), "[0.1,0.2,0.3]");
  });

  it("1536 维向量格式正确", () => {
    const vec = Array.from({ length: 1536 }, () => Math.random());
    const result = toVectorLiteral(vec);
    assert.ok(result.startsWith("[") && result.endsWith("]"));
    assert.equal(result.split(",").length, 1536);
  });
});
