/* ============================================================
   人设保真度评估 (persona fidelity) — held-out 消息预测
   灵感来自 olmOCR-Bench：给系统一个可量化、可复现的质量基准。

   方法:
   1. 从档案里解析出「角色说过的真实消息」序列（对话对）
   2. 留出一部分作为 held-out（不让模型在 prompt 里看到答案）
   3. 用当前 persona 模型预测角色在该语境下会怎么回
   4. 预测 vs 真实，用 embedding 余弦相似度打分
   5. 平均分 = fidelity score，落在 0-1

   纯读操作，不改任何数据。评估本身消耗少量 LLM+embedding 调用。
   ============================================================ */
import { embed, toVectorLiteral } from "./embeddings.js";
import { chat } from "./llm.js";
import { q } from "../db.js";
import { SCORE_SWEEP_GRID, resolveRetrievalParams } from "./retrieval.js";

// 余弦相似度
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// 相似度 → 等级
export function grade(sim) {
  if (sim >= 0.85) return "A";
  if (sim >= 0.72) return "B";
  if (sim >= 0.55) return "C";
  return "D";
}

/* 从聊天记录文本里解析出「上一句 → 角色回复」的对话对
   兼容常见格式:
     他：xxx / 我：xxx
     roleName: xxx / Me: xxx
   规则: 角色发言且其前一句是对方发言，构成一个 (prompt, reply) 对 */
export function parsePairs(text, roleName) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 判定说话人: 冒号(全角/半角)前的部分
  const parsed = lines.map((line) => {
    const m = line.match(/^([^:：]{1,12})[：:]\s*(.+)$/);
    if (!m) return null;
    const speaker = m[1].trim();
    return { speaker, content: m[2].trim() };
  }).filter(Boolean);

  // 角色的标识: roleName 或 常见「他/她/对方/TA」
  const isRole = (sp) => sp === roleName || /^(他|她|ta|TA|对方)$/i.test(sp);

  const pairs = [];
  for (let i = 1; i < parsed.length; i++) {
    const cur = parsed[i], prev = parsed[i - 1];
    if (isRole(cur.speaker) && !isRole(prev.speaker)) {
      pairs.push({ prompt: prev.content, reply: cur.content });
    }
  }
  return pairs;
}

/* 用 persona 模型预测角色的回复（精简版，不含检索，纯靠人设 + 单轮语境） */
async function predictReply(name, language, model, promptMsg) {
  const system = `你在扮演"${name}"。严格模仿其说话方式，只输出一句回复，不要解释。

## 说话风格
${(model.style || []).join("；") || "（无）"}

## ${name}的原话样本（严格模仿语气/句长/用词）
${(model.phrases || []).map((p) => `"${p}"`).join("\n") || "（无）"}

## 规则
1. 用「${language}」回复
2. 句长/语气/标点贴合原话样本，不要更书面更长
3. 只输出回复本身，一句话`;
  return chat(system, [{ role: "user", content: promptMsg }], 200);
}

/* 主评估函数
   archives: [{ kind, content }]  已解密的文本档案
   character: { name, language, persona_model }
   opts: { sampleSize } 最多评估多少对（控制成本，默认 8） */
export async function evaluateFidelity(archives, character, opts = {}) {
  const sampleSize = opts.sampleSize || 8;
  const model = character.persona_model || {};

  // 1. 汇集所有对话对
  let pairs = [];
  for (const a of archives) {
    if (a.kind !== "text") continue;
    pairs.push(...parsePairs(a.content, character.name));
  }
  if (pairs.length < 3) {
    return { score: null, reason: "insufficient_pairs", pairs: pairs.length };
  }

  // 2. 均匀采样 held-out（避免全取开头，跨档案分布）
  const step = Math.max(1, Math.floor(pairs.length / sampleSize));
  const sample = [];
  for (let i = 0; i < pairs.length && sample.length < sampleSize; i += step) sample.push(pairs[i]);

  // 3. 逐对预测 + 打分
  const results = [];
  for (const pair of sample) {
    try {
      const predicted = await predictReply(character.name, character.language, model, pair.prompt);
      const [pv, av] = await embed([predicted.trim(), pair.reply]);
      const sim = cosine(pv, av);
      results.push({ prompt: pair.prompt, actual: pair.reply, predicted: predicted.trim(), similarity: Number(sim.toFixed(3)) });
    } catch (e) {
      // 单对失败不影响整体
      console.error("[eval] pair failed:", e.message);
    }
  }
  if (!results.length) return { score: null, reason: "all_failed" };

  const avg = results.reduce((s, r) => s + r.similarity, 0) / results.length;
  return {
    score: Number(avg.toFixed(3)),
    grade: grade(avg),
    sampledPairs: results.length,
    totalPairs: pairs.length,
    samples: results,
  };
}

/* ============================================================
   检索阈值扫描 (retrieval threshold sweep)
   目的: 把“MIN_SCORE 该设多少”从拍脑袋变成看数据。
   方法: 用该角色真实的对话 prompt 当查询, 跑向量检索, 统计每个候选阈值下
         平均命中数与命中分数分布, 帮你为这个角色选出合适的阈值。
   纯读操作。相比固定 0.25, 结合 retrieval.js 的自适应策略一起用效果最好。
   ============================================================ */
export async function sweepRetrievalThreshold(characterId, archives, roleName, opts = {}) {
  const sampleSize = opts.sampleSize || 12;

  // 1. 从文本档案里取角色对话的“上一句”当作真实查询语料
  let prompts = [];
  for (const a of archives) {
    if (a.kind !== "text") continue;
    prompts.push(...parsePairs(a.content, roleName).map((p) => p.prompt));
  }
  prompts = prompts.filter((p) => p && p.length > 1);
  if (prompts.length < 3) return { ok: false, reason: "insufficient_queries", queries: prompts.length };

  // 均匀采样
  const step = Math.max(1, Math.floor(prompts.length / sampleSize));
  const sample = [];
  for (let i = 0; i < prompts.length && sample.length < sampleSize; i += step) sample.push(prompts[i]);

  // 2. chunk 总数 → 自适应参数(作为参考基线一并返回)
  const { rows: cnt } = await q("SELECT count(*)::int AS n FROM chunks WHERE character_id=$1", [characterId]);
  const chunkCount = cnt[0]?.n || 0;
  const adaptive = resolveRetrievalParams(chunkCount);

  // 3. 每个查询取 top-12 的分数, 汇总
  const allScores = [];
  for (const p of sample) {
    try {
      const [qv] = await embed(p);
      const { rows } = await q(
        `SELECT 1 - (embedding <=> $2::vector) AS score
         FROM chunks WHERE character_id=$1
         ORDER BY embedding <=> $2::vector LIMIT 12`,
        [characterId, toVectorLiteral(qv)]
      );
      allScores.push(rows.map((r) => Number(r.score)));
    } catch (e) {
      console.error("[sweep] query failed:", e.message);
    }
  }
  if (!allScores.length) return { ok: false, reason: "all_failed" };

  // 4. 对每个候选阈值: 平均每查询能留下几条
  const grid = SCORE_SWEEP_GRID.map((thr) => {
    const kept = allScores.map((scores) => scores.filter((s) => s > thr).length);
    const avgKept = kept.reduce((a, b) => a + b, 0) / kept.length;
    const emptyRate = kept.filter((k) => k === 0).length / kept.length; // 完全没召回的查询占比
    return { threshold: thr, avgKept: Number(avgKept.toFixed(2)), emptyRate: Number(emptyRate.toFixed(2)) };
  });

  // 5. 给个直觉建议: 在“召回不落空(emptyRate 低)”与“不过量(avgKept 适中)”之间取平衡
  const recommended = grid
    .filter((g) => g.emptyRate <= 0.2)
    .sort((a, b) => a.avgKept - b.avgKept)[0]?.threshold ?? adaptive.minScore;

  return {
    ok: true,
    chunkCount,
    sampledQueries: allScores.length,
    adaptiveBaseline: adaptive,     // 当前自适应策略会用的参数
    grid,                            // 各阈值的召回统计
    recommendedThreshold: recommended,
  };
}
