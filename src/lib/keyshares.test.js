import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { splitKey, combineKey } from "./keyshares.js";

test("keyshares: 3-of-5 恢复(随机子集)", () => {
  for (let i = 0; i < 20; i++) {
    const key = crypto.randomBytes(32).toString("hex");
    const shares = splitKey(key, 5, 3);
    const idx = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5).slice(0, 3);
    assert.equal(combineKey(idx.map((j) => shares[j])), key);
  }
});

test("keyshares: 2-of-4 任意两份都能恢复", () => {
  const key = crypto.randomBytes(32).toString("hex");
  const s = splitKey(key, 4, 2);
  assert.equal(combineKey([s[0], s[1]]), key);
  assert.equal(combineKey([s[2], s[3]]), key);
  assert.equal(combineKey([s[1], s[3]]), key);
});

test("keyshares: 超过阈值份数也能恢复", () => {
  const key = crypto.randomBytes(32).toString("hex");
  const s = splitKey(key, 5, 3);
  assert.equal(combineKey(s), key);
});

test("keyshares: 非法参数抛错", () => {
  assert.throws(() => splitKey("xyz", 5, 3));
  assert.throws(() => splitKey(crypto.randomBytes(32).toString("hex"), 3, 5)); // t>n
  assert.throws(() => combineKey(["01-ab"]));
});
