// ============================================================
// 自适应检索参数 — 按角色的数据体量动态调整 top-k 与相似度阈值
//
// 问题背景:
//   固定 TOP_K=6 / MIN_SCORE=0.25 是经验值，对长尾分布不友好:
//   - 数据少时(冷启动): 阈值偏高会把仅有的相关片段过滤掉 → 检索经常空手而归
//   - 数据多时: 阈值偏低会放进大量弱相关噪音 → 稀释人设、拉长 prompt
//   本模块让参数随 chunk 数量平滑变化，两端都更合理。
//
//   仍尊重环境变量: 若显式设了 RETRIEVAL_TOP_K / RETRIEVAL_MIN_SCORE，
//   则视为“硬上限/硬下限”，自适应值不会越过它们。
// ============================================================

// 环境变量作为边界约束(可选)。不设则用内置默认区间。
const ENV_TOP_K = process.env.RETRIEVAL_TOP_K ? parseInt(process.env.RETRIEVAL_TOP_K) : null;
const ENV_MIN_SCORE = process.env.RETRIEVAL_MIN_SCORE != null && process.env.RETRIEVAL_MIN_SCORE !== ""
  ? parseFloat(process.env.RETRIEVAL_MIN_SCORE)
  : null;

// 自适应区间（可被上面的环境变量收窄）
const TOP_K_MIN = 3;    // 再少的数据也至少捞 3 条候选
const TOP_K_MAX = 12;   // 数据再多也不无限膨胀 prompt
const SCORE_FLOOR = 0.18; // 冷启动期最宽松的阈值(宁可多召回)
const SCORE_CEIL = 0.32;  // 数据充裕期最严格的阈值(过滤噪音)

/**
 * 根据 chunk 数量解析该角色本次检索应使用的参数。
 * @param {number} chunkCount 该角色当前已索引的分块总数
 * @returns {{ topK: number, minScore: number, tier: string }}
 */
export function resolveRetrievalParams(chunkCount = 0) {
  const n = Math.max(0, Number(chunkCount) || 0);

  // 分三档: 冷启动 / 成长期 / 充裕期。用对数把 chunk 数映射到 0~1 的“充裕度”。
  // n=0 → 0 ; n≈30 → ~0.5 ; n≈300 → ~1
  const fullness = n <= 0 ? 0 : Math.min(1, Math.log10(n + 1) / Math.log10(300));

  // top-k 随充裕度线性增长
  let topK = Math.round(TOP_K_MIN + (TOP_K_MAX - TOP_K_MIN) * fullness);

  // 阈值随充裕度收紧: 数据越多越挑剔
  let minScore = Number((SCORE_FLOOR + (SCORE_CEIL - SCORE_FLOOR) * fullness).toFixed(3));

  // 环境变量作为硬边界: 用户显式配置则不越界
  if (ENV_TOP_K != null) topK = Math.min(topK, Math.max(1, ENV_TOP_K));
  if (ENV_MIN_SCORE != null) minScore = ENV_MIN_SCORE; // 显式配置则完全遵从(视为固定策略)

  const tier = fullness < 0.34 ? "cold" : fullness < 0.7 ? "growing" : "rich";
  return { topK, minScore, tier };
}

/**
 * 阈值扫描的候选网格 — 供 /eval 的阈值 sweep 使用，找出对当前角色最优的 MIN_SCORE。
 */
export const SCORE_SWEEP_GRID = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
