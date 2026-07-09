// 人设建模: 单档案特征提取 + 聚合(增量, 不再全量重放)
import { q } from "../db.js";
import { chat, parseJson, MODELS } from "./llm.js";
export { validateFeatures } from "./validate.js";

export const EXTRACT_SYSTEM = "你是特征提取引擎，只输出JSON，不输出任何其他文字或markdown代码块。";

// ── 文字数据的提取 prompt（针对聊天记录/转述优化）──
const textPrompt = (roleName) => `以下是关于"${roleName}"的文字数据（聊天记录、转述或真实记录）。提取特征。

规则:
- facts: 客观事实（身份/经历/关系），每条<25字
- style: 说话风格客观特征（句长/语气词/标点/emoji/称呼习惯），每条<25字，聚焦"怎么说"而非"说了什么"
- phrases: 逐字摘出"${roleName}"说过的典型句子，一字不改保持原文，最多8条，优先选最能体现说话习惯的
- patterns: 行为模式（回复节奏/话题倾向/情绪表达方式），每条<25字
- 只提取数据里真实存在的，绝不推测不脑补，宁缺毋滥
- 双方对话只提取"${roleName}"一方的特征，不要把对方的话当成TA的

只返回JSON: {"facts":[],"style":[],"phrases":[],"patterns":[]}`;

// ── 图片数据的提取 prompt（针对截图优化：先看懂再提取）──
const imagePrompt = (roleName) => `这是一张关于"${roleName}"的图片（很可能是聊天截图）。

先在心里读懂图片：谁是"${roleName}"（通常是对话气泡靠一侧、非"我"发出的一方），识别每条消息的发送方。然后只提取"${roleName}"一方的特征。

规则:
- facts: 从图片内容能确认的客观事实，每条<25字
- style: "${roleName}"的说话风格（句长/语气词/标点/emoji/称呼），每条<25字
- phrases: 逐字摘录"${roleName}"发出的消息原文（不是"我"发的），最多8条
- patterns: 行为模式，每条<25字
- 分不清发送方时宁可不提取该条，不要猜
- 图片里的时间戳、界面文字、对方消息都不是"${roleName}"的特征

只返回JSON: {"facts":[],"style":[],"phrases":[],"patterns":[]}`;

// 向后兼容旧引用
export const extractPrompt = textPrompt;

/**
 * 单档案独立提取（不依赖当前模型 → 每个档案的特征可缓存）
 * @param mode "fast" | "deep" — 深度模式用更强模型，适合重要/复杂档案
 */
export async function extractFeatures(roleName, payload, isImage, mode = "fast") {
  const model = mode === "deep" ? MODELS.deep : MODELS.fast;
  const content = isImage
    ? [{ type: "image", mediaType: payload.mediaType, data: payload.data }, { type: "text", text: imagePrompt(roleName) }]
    : `数据内容:\n${payload}\n\n${textPrompt(roleName)}`;
  const raw = await chat(EXTRACT_SYSTEM, [{ role: "user", content }], 1500, { model });
  const p = parseJson(raw);
  return {
    facts: (p.facts || []).slice(0, 12),
    style: (p.style || []).slice(0, 12),
    phrases: (p.phrases || []).slice(0, 8),
    patterns: (p.patterns || []).slice(0, 12),
  };
}

// 聚合: persona_model = 全部档案features的合并(去重+截断)。纯DB+JS操作，零API成本。
export async function aggregateModel(characterId) {
  const { rows } = await q(
    "SELECT features FROM archives WHERE character_id=$1 AND features IS NOT NULL ORDER BY created_at ASC",
    [characterId]
  );
  const merge = (key, cap) => {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      for (const item of r.features?.[key] || []) {
        const norm = String(item).trim();
        if (norm && !seen.has(norm)) { seen.add(norm); out.push(norm); }
      }
    }
    return out.slice(-cap); // 保留最新的cap条
  };
  const model = {
    facts: merge("facts", 15),
    style: merge("style", 12),
    phrases: merge("phrases", 20),
    patterns: merge("patterns", 12),
  };
  await q("UPDATE characters SET persona_model=$2 WHERE id=$1", [characterId, JSON.stringify(model)]);
  return model;
}

export const memoryPrompt = (transcript, memory) => `你是记忆提炼引擎。根据对话更新对用户的结构化记忆。
当前记忆: ${JSON.stringify(memory)}
最近对话:
${transcript}
规则: facts=用户硬信息 patterns=用户行为情绪模式 emotions=一句话当前情绪 threads=未聊完话题(最多5条)。每类<12条,每条<25字。只返回:{"facts":[],"patterns":[],"emotions":"","threads":[]}`;

export function buildSystemPrompt(name, language, model, memory, retrieved) {
  return `你在扮演"${name}"。人设完全来自真实数据提炼，严格遵守，绝不脱离角色。

## 客观事实
${model.facts.join("；") || "（数据不足）"}

## 说话风格（严格模仿）
${model.style.join("；") || "（数据不足）"}

## ${name}的原话样本（模仿语气/句长/用词，这比任何描述都重要）
${model.phrases.map((p) => `"${p}"`).join("\n") || "（无样本）"}

## 行为模式
${model.patterns.join("；") || "（数据不足）"}

## 与当前话题相关的历史片段（向量检索命中，可自然引用其中细节）
${retrieved && retrieved.length ? retrieved.map((r, i) => `[${i + 1}] ${r}`).join("\n") : "（无）"}

## 你对用户的记忆
- 事实: ${memory.facts.join("；") || "（无）"}
- 模式: ${memory.patterns.join("；") || "（无）"}
- 上次情绪: ${memory.emotions || "（首次）"}
- 未完话题: ${memory.threads.join("；") || "（无）"}

## 规则
1. 始终用「${language}」这门语言回复，无论用户用什么语言输入
2. 未完话题有内容时在自然时机主动提起
3. 上次情绪负面则开场带关心的余温
4. 回复句长/语气词/标点贴合原话样本，不要更长更书面
5. 绝不说"作为AI"之类出戏的话`;
}

/* 计算一个角色所有档案的整体提取健康度（0-1），供前端展示 */
export async function extractionHealth(characterId) {
  const { rows } = await q(
    "SELECT quality_issues FROM archives WHERE character_id=$1 AND features IS NOT NULL",
    [characterId]
  );
  if (!rows.length) return { score: null, total: 0, clean: 0 };
  const clean = rows.filter((r) => !r.quality_issues || r.quality_issues.length === 0).length;
  return {
    score: Number((clean / rows.length).toFixed(2)),
    total: rows.length,
    clean,
  };
}
