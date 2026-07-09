// LLM 适配层 — 不限定API提供商
// LLM_PROVIDER=anthropic | openai  (openai模式兼容一切OpenAI格式的服务)
// 内置: 请求超时 / 自动重试(指数退避) / 健壮JSON解析
const PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
const API_KEY = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = (process.env.LLM_BASE_URL || (PROVIDER === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1")).replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || (PROVIDER === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o-mini");
const TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS) || 60_000;
const MAX_RETRIES = 2;

/* ---------- 带超时的 fetch ---------- */
async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 重试包装: 429/5xx/网络错误 指数退避 ---------- */
async function withRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retriable = e.retriable || e.name === "AbortError" || e.code === "ECONNRESET";
      if (!retriable || attempt === MAX_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // 1s → 2s → 4s
    }
  }
  throw lastErr;
}

function httpError(status, body) {
  const err = new Error(`LLM ${status}: ${body}`);
  err.retriable = status === 429 || status >= 500;
  return err;
}

/* ---------- 统一消息格式转换 ---------- */
function toAnthropic(messages) {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map((p) =>
      p.type === "image"
        ? { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } }
        : { type: "text", text: p.text }
    ),
  }));
}
function toOpenAI(system, messages) {
  const mapped = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map((p) =>
      p.type === "image"
        ? { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}` } }
        : { type: "text", text: p.text }
    ),
  }));
  return [{ role: "system", content: system }, ...mapped];
}

export async function chat(system, messages, maxTokens = 1200) {
  if (!API_KEY) throw new Error("缺少 LLM_API_KEY");
  return withRetry(async () => {
    if (PROVIDER === "anthropic") {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: toAnthropic(messages) }),
      });
      if (!res.ok) throw httpError(res.status, await res.text());
      const data = await res.json();
      return data.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    }
    // openai-compatible
    const res = await fetchWithTimeout(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: toOpenAI(system, messages) }),
    });
    if (!res.ok) throw httpError(res.status, await res.text());
    const data = await res.json();
    return data.choices[0].message.content || "";
  });
}

/* ---------- 健壮 JSON 解析 ----------
   1. 去掉 markdown 代码块
   2. 直接 parse
   3. 失败则提取第一个 {...} 或 [...] 再 parse (LLM 前后带解释文字时) */
export function parseJson(raw) {
  const cleaned = String(raw).replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fallthrough */ }
    }
    const err = new Error(`LLM返回的不是有效JSON: ${cleaned.slice(0, 120)}...`);
    err.rawOutput = raw;
    throw err;
  }
}

/* ---------- 粗略token估算 (中文≈1.5字符/token, 英文≈4字符/token, 取保守值2) ---------- */
export const estimateTokens = (text) => Math.ceil(String(text).length / 2);
