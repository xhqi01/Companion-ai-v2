/* ============================================================
   特征提取质量验证 — 纯函数，无外部依赖，零API调用
   灵感来自 olmOCR 用可程序验证的标准衡量结构化输出质量
   ============================================================ */
export function validateFeatures(features, rawText, isImage = false) {
  const issues = [];
  const text = String(rawText || "");
  const strip = (s) => String(s).replace(/[\s，。！？、,.!?""''：:]/g, "");

  // 1. 幻觉检测: phrases 声称逐字摘录，必须能在原文找到痕迹
  //    图片档案原文是转录文本，比对不精确，放宽
  if (!isImage) {
    const haystack = strip(text);
    for (const phrase of features.phrases || []) {
      const p = String(phrase).trim();
      if (p.length < 2) continue;
      const probe = strip(p).slice(0, 5);
      if (probe && !haystack.includes(probe)) {
        issues.push({ type: "phantom_phrase", value: p });
      }
    }
  }

  // 2. 冗余检测: style 描述过长说明在复述而非提炼
  for (const s of features.style || []) {
    if (String(s).length > 40) issues.push({ type: "style_too_verbose", value: s });
  }

  // 3. 空提取: 有内容的数据却提不出任何特征
  const total = (features.facts?.length || 0) + (features.style?.length || 0)
    + (features.phrases?.length || 0) + (features.patterns?.length || 0);
  if (total === 0 && text.length > 30) issues.push({ type: "empty_extraction" });

  // 4. 过度提取: 特征数量远超数据体量，多半在编造
  const budget = Math.ceil(text.length / 40) + 4;
  if (total > budget && total > 15) issues.push({ type: "over_extraction", count: total, budget });

  return issues;
}
