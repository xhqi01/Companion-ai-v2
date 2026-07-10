import { test } from "node:test";
import assert from "node:assert/strict";
import { detectReliance, groundingNote } from "./wellbeing.js";

test("wellbeing: 识别强依恋信号(多语言)", () => {
  assert.equal(detectReliance("你是我唯一能说话的人"), true);
  assert.equal(detectReliance("你还在吗"), true);
  assert.equal(detectReliance("I can't live without you"), true);
  assert.equal(detectReliance("あなただけが分かってくれる"), true);
});

test("wellbeing: 普通对话不触发", () => {
  assert.equal(detectReliance("今天想聊聊工作"), false);
  assert.equal(detectReliance("帮我看下这段代码"), false);
  assert.equal(detectReliance(""), false);
});

test("wellbeing: 落地提示受最小间隔约束", () => {
  const hit = groundingNote({ message: "你是我唯一", turnCount: 30, lastGroundedAt: 0 });
  assert.equal(hit.inject, true);
  assert.equal(hit.groundedAt, 30);

  const tooSoon = groundingNote({ message: "你是我唯一", turnCount: 30, lastGroundedAt: 20 });
  assert.equal(tooSoon.inject, false);

  const noSignal = groundingNote({ message: "聊聊天气", turnCount: 100, lastGroundedAt: 0 });
  assert.equal(noSignal.inject, false);
});
