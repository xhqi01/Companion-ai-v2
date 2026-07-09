// Embedding 适配层 — 不限定提供商 (任何OpenAI格式的embedding服务可用)
// ⚠️ 换用维度≠1536的模型时，需同步修改 db/schema.sql 里 vector(1536) 并重建 chunks 表
const BASE_URL = (process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const API_KEY = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const BATCH_SIZE = 64;         // 单次请求最多embed的文本数（防止payload过大）
const TIMEOUT_MS = 30_000;

async function embedBatch(input) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, input }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Embedding ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.data.map((d) => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}

export async function embed(texts) {
  if (!API_KEY) throw new Error("缺少 EMBEDDING_API_KEY");
  const input = Array.isArray(texts) ? texts : [texts];
  if (input.length <= BATCH_SIZE) return embedBatch(input);
  // 大量分块时按批次请求，避免单次payload超限
  const out = [];
  for (let i = 0; i < input.length; i += BATCH_SIZE) {
    out.push(...(await embedBatch(input.slice(i, i + BATCH_SIZE))));
  }
  return out;
}

// 分块: 按行聚合到 ~500 字符，带 1 行重叠
export function chunkText(text, maxLen = 500) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length > maxLen && buf.length) {
      chunks.push(buf.join("\n"));
      buf = [buf[buf.length - 1]];
      len = buf[0].length;
    }
    buf.push(line);
    len += line.length;
  }
  if (buf.length) chunks.push(buf.join("\n"));
  return chunks.filter((c) => c.trim().length > 10);
}

export const toVectorLiteral = (arr) => `[${arr.join(",")}]`;
