import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cosine, grade, parsePairs } from "./eval.js";

describe("cosine 余弦相似度", () => {
  it("相同向量为 1", () => {
    assert.equal(cosine([1, 2, 3], [1, 2, 3]), 1);
  });
  it("正交向量为 0", () => {
    assert.equal(cosine([1, 0], [0, 1]), 0);
  });
  it("零向量安全返回 0", () => {
    assert.equal(cosine([0, 0], [1, 1]), 0);
  });
});

describe("grade 等级映射", () => {
  it("高分为 A", () => assert.equal(grade(0.9), "A"));
  it("中高为 B", () => assert.equal(grade(0.75), "B"));
  it("中为 C", () => assert.equal(grade(0.6), "C"));
  it("低为 D", () => assert.equal(grade(0.3), "D"));
});

describe("parsePairs 对话对解析", () => {
  it("解析「他/我」格式", () => {
    const text = "我：在吗\n他：在的\n我：吃饭没\n他：刚吃完";
    const pairs = parsePairs(text, "他");
    assert.equal(pairs.length, 2);
    assert.deepEqual(pairs[0], { prompt: "在吗", reply: "在的" });
    assert.deepEqual(pairs[1], { prompt: "吃饭没", reply: "刚吃完" });
  });

  it("用角色真名匹配", () => {
    const text = "Me: hey\nFrank: hi there\nMe: how are you\nFrank: good";
    const pairs = parsePairs(text, "Frank");
    assert.equal(pairs.length, 2);
    assert.equal(pairs[0].reply, "hi there");
  });

  it("连续角色发言不重复配对", () => {
    const text = "我：问题\n他：回答一\n他：回答二";
    const pairs = parsePairs(text, "他");
    // 只有「我→他」构成一对；「他→他」不算
    assert.equal(pairs.length, 1);
  });

  it("无冒号的行被忽略", () => {
    const text = "随便一行没有说话人\n我：你好\n他：嗨";
    const pairs = parsePairs(text, "他");
    assert.equal(pairs.length, 1);
  });

  it("用「对方」等泛称也能识别角色", () => {
    const text = "我：晚安\n对方：晚安好梦";
    const pairs = parsePairs(text, "某人");
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].reply, "晚安好梦");
  });
});
