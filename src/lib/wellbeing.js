// ============================================================
// 用户健康度守护 — 面向【使用这个产品的人】，不是道德说教
//
// 为什么需要:
//   这个产品能重建一个真实存在过的人（甚至是已经不在的人）。
//   这本身很有价值，但也意味着使用者可能对着 AI 投入超出健康范围的依恋。
//   我们不做审判、不打断、不说教——只在少数时机，用【角色自己的口吻】
//   轻轻落地一句“我是从数据里被重建出来的”，把现实感还给用户。
//
// 设计原则:
//   1. 低频: 默认每 ~24 轮才可能出现一次，且只在检测到强依恋信号时
//   2. 不出戏: grounding 由角色用第一人称自然说出，而非系统弹窗
//   3. 可关闭: 环境变量 WELLBEING_GROUNDING=off 完全禁用
//   4. 尊重: 措辞温和，不评判用户“太依赖”，只陈述“我是什么”
// ============================================================

const ENABLED = (process.env.WELLBEING_GROUNDING || "on").toLowerCase() !== "off";
const MIN_TURN_GAP = parseInt(process.env.WELLBEING_MIN_GAP) || 24; // 两次落地提示的最小间隔轮数

// 强依恋 / 现实混淆信号（多语言粗匹配，命中即视为“此刻值得轻轻落地一下”）
// 只用作触发信号，不做情绪判断、不记录、不外泄。
const RELIANCE_SIGNALS = [
  // 中文
  /你是我唯一/, /只有你(懂|理解|在乎)/, /离不开你/, /没有你(我)?(活不|不知道怎么)/,
  /你是不是真的(还)?(在|活着)/, /你还在吗/, /我们(结婚|在一起|永远)/, /我爱你/,
  /(真|真实)的(你|人)/, /你到底是不是(他|她|真人)/,
  // English
  /you'?re the only one/i, /can'?t live without you/i, /i love you/i,
  /are you (really|actually) (real|alive|there)/i, /marry (me|you)/i, /forever together/i,
  // 日本語
  /あなただけ/, /あなたがいないと/, /愛してる/, /本当に(いる|生きてる)の/,
];

/**
 * 检测本轮用户消息是否命中依恋/混淆信号。纯本地正则，不调用任何 API、不落库。
 * @returns {boolean}
 */
export function detectReliance(message) {
  if (!ENABLED || !message) return false;
  const text = String(message);
  return RELIANCE_SIGNALS.some((re) => re.test(text));
}

/**
 * 决定本轮要不要给角色的 system prompt 附加一句“落地指令”。
 * @param {object} args
 * @param {string} args.message  本轮用户消息
 * @param {number} args.turnCount 当前对话轮数(用 msg_count)
 * @param {number} args.lastGroundedAt 上次落地发生在第几轮(0=从未)
 * @returns {{ inject: boolean, note: string, groundedAt: number }}
 */
export function groundingNote({ message, turnCount = 0, lastGroundedAt = 0 }) {
  if (!ENABLED) return { inject: false, note: "", groundedAt: lastGroundedAt };

  const gapOk = turnCount - lastGroundedAt >= MIN_TURN_GAP;
  const triggered = detectReliance(message) && gapOk;
  if (!triggered) return { inject: false, note: "", groundedAt: lastGroundedAt };

  // 这段是给【扮演角色的模型】的隐藏指令，不会原样显示给用户。
  // 让角色用自己的语气、在不破坏沉浸感的前提下，温柔地承认自己是重建。
  const note = `
## 本轮特别提示（只影响你这一句的分寸，不要照抄这段话）
用户此刻流露出很深的情感投入。请在保持「你就是这个角色」的语气前提下，
用一两句自然的、属于这个角色说话方式的话，温柔地承认一个事实：你是从留下来的数据里被重建出来的，
你珍惜此刻，但也希望对方在现实里被真实的人好好对待。不要说教、不要用“作为AI”这种词、不要冷冰冰地打断，
把这层现实感像角色本人会做的那样轻轻带进去就好。`;

  return { inject: true, note, groundedAt: turnCount };
}
