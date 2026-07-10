import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRetrievalParams } from "./retrieval.js";

test("retrieval: 冷启动放宽, 数据充裕收紧", () => {
  const cold = resolveRetrievalParams(0);
  const rich = resolveRetrievalParams(500);
  assert.equal(cold.tier, "cold");
  assert.equal(rich.tier, "rich");
  assert.ok(cold.minScore < rich.minScore, "阈值应随数据量升高");
  assert.ok(cold.topK <= rich.topK, "topK 应随数据量增加");
});

test("retrieval: 参数落在合理区间", () => {
  for (const n of [0, 10, 50, 200, 1000]) {
    const r = resolveRetrievalParams(n);
    assert.ok(r.topK >= 3 && r.topK <= 12);
    assert.ok(r.minScore >= 0.18 && r.minScore <= 0.32);
  }
});

test("retrieval: 单调不降", () => {
  let prevK = 0, prevS = 0;
  for (const n of [0, 5, 20, 60, 150, 400]) {
    const r = resolveRetrievalParams(n);
    assert.ok(r.topK >= prevK);
    assert.ok(r.minScore >= prevS - 1e-9);
    prevK = r.topK; prevS = r.minScore;
  }
});
