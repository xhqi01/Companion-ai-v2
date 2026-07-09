# Companion

![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white) ![React](https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=black) ![License](https://img.shields.io/badge/license-MIT-blue) ![LLM](https://img.shields.io/badge/LLM-provider--agnostic-8A2BE2)

**English** · [中文](#中文) · [日本語](#日本語)

---

## English

A different kind of AI companion: the persona isn't written — it's extracted from data.

Most AI companion products ask you to fill in personality tags, and the AI roleplays from those tags. After a while, the script runs dry and the persona feels thin. Companion works the other way: you feed it real, objective data (chat logs, screenshots, written records), and the system — like training a small model — extracts that person's speech style, common phrases, and behavioral patterns to build a persona model that's closer to who they actually are. The data lives as editable archives: view, edit, or delete any entry at any time, and the model re-extracts automatically. Nothing is written in stone.

During conversation, instead of stuffing all memory into the prompt, Companion uses vector search (RAG) to retrieve the most semantically relevant historical fragments in real time. That's why it can still "remember details" even when the data grows large — instead of getting vague when things pile up.

### Screenshots

*(Screenshots coming soon — run the frontend locally to see the chat UI, persona model visualization, and archive panel.)*

### What this project does

**1. Persona = distilled from data, not stacked descriptions**  
Feed chat logs / screenshots → the LLM extracts objective features (facts, speech style, verbatim phrase samples, behavioral patterns) → merged into a continuously updated persona model. You don't write "gentle" or "cold" — the system figures that out from the data.

**2. Two memory layers, each doing its job**  
- **Persona model**: who this character is — built from all your archives, editable, model rebuilds on change  
- **Conversation memory**: what the character knows about *you* — auto-distilled every few turns (facts / emotions / open threads), picks up each conversation with the warmth of the last one

**3. Retrieval instead of stuffing — solves "can't remember details" and storage limits**  
Every piece of data is chunked, embedded, and stored in pgvector. At inference time, the most semantically relevant chunks are retrieved first. No ever-growing JSON trying to hold everything. All raw data is AES-256-GCM encrypted before hitting the database — no browser storage limits.

### Who is this for

Anyone building something beyond "fill tags and chat": reconstructing a person who actually existed (even someone who's gone), training an AI character from a real conversation history, or simply believing that AI personas should grow from data, not be described into existence.

Supports any conversation language. The language of your training data doesn't affect which language you converse in.

### Architecture
Feed data ──→ Encrypt & archive (AES-256-GCM)
│
├──→ Feature extraction (LLM) ──→ persona_model  { facts, style, phrases, patterns }
│                                      ↑
│                               cached per archive
│                               re-aggregated on change (zero API cost)
│
└──→ Chunk + embed ──→ pgvector index
Chat ──→ embed message ──→ semantic search (top-k retrieval)
│
└──→ persona_model + retrieved chunks + conversation memory ──→ LLM ──→ reply
│
background memory distillation every 3 turns

**Tech stack**: Node.js (Express) · PostgreSQL + pgvector · React (Vite) · LLM and Embedding provider-agnostic

### Any LLM provider

Both LLM and Embedding are configured via environment variables — no vendor lock-in:

| Purpose | Variables | Notes |
|---|---|---|
| Chat / extraction | `LLM_PROVIDER` `LLM_API_KEY` `LLM_BASE_URL` `LLM_MODEL` | `anthropic` or `openai`; openai mode works with OpenAI / DeepSeek / OpenRouter / Moonshot / Qwen / local Ollama… |
| Embeddings | `EMBEDDING_API_KEY` `EMBEDDING_BASE_URL` `EMBEDDING_MODEL` | Any OpenAI-format embedding service: OpenAI / Voyage / Jina / local… |

Switch the full stack to DeepSeek + Jina, Claude + Voyage, or local Ollama — change env vars, zero code changes.  
⚠️ If you switch to an embedding model with dimensions ≠ 1536, update `vector(1536)` in `db/schema.sql`.  
⚠️ Image archive transcription requires a vision-capable model (Claude, GPT-4o, etc.). Text archives work with any model.

### Quick start

**Option A: One command (Docker, recommended)**

```bash
./setup.sh          # checks deps, generates keys, starts DB, inits schema, runs tests
# then edit .env with your API keys and:
npm run dev
```

Or run the entire stack (DB + backend + frontend) in Docker:

```bash
cp .env.example .env   # fill in LLM_API_KEY & EMBEDDING_API_KEY
docker compose up      # frontend at :5173, backend at :3001, pgvector at :5432
```

**Option B: Manual setup**

**1. Database (Supabase free tier recommended)**

1. Create a project at [supabase.com](https://supabase.com)
2. Run `db/schema.sql` in full in the SQL Editor (enables pgvector)
3. Copy the connection string from Project Settings → Database

**2. Environment variables**

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `LLM_API_KEY`, `EMBEDDING_API_KEY`, then generate your keys:

```bash
# ENCRYPTION_KEY (64-char hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# JWT_SECRET (at least 32 chars)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> ⚠️ **Back up `ENCRYPTION_KEY` immediately** — store it in a password manager. If it's lost, all encrypted data is permanently unrecoverable. Make sure the value in your deployment platform matches your local `.env` exactly.

**3. Backend**

```bash
npm install
npm run db:init   # skip if you already ran schema.sql manually
npm run dev
```

**4. Deploy**

Railway / Render / Fly.io — connect the GitHub repo, set environment variables, done. `PORT` is injected automatically.

**5. Frontend (`frontend/` directory)**

```bash
cd frontend
cp .env.example .env    # set VITE_API_BASE to your backend URL
npm install
npm run dev             # local dev
npm run build           # output in dist/, deploy to Vercel / Netlify / Cloudflare Pages
```

### API reference

All `/api/characters` routes require `Authorization: Bearer <token>`.

**Auth**
POST /api/auth/register    { email, password }  →  { token, user }   # password ≥ 8 chars, bcrypt
POST /api/auth/login       { email, password }  →  { token, user }   # token valid 7 days

**Characters**
POST   /api/characters                   { name, language }
GET    /api/characters
GET    /api/characters/:id
PATCH  /api/characters/:id               { name?, language? }
GET    /api/characters/:id/eval          →  persona fidelity score (held-out evaluation)
GET    /api/characters/:id/export        →  persona model + memory + archive list as JSON (?full=1 adds decrypted archives)
DELETE /api/characters/:id

**Archives** (each feed = one encrypted, editable archive)
POST   /api/characters/:id/archives      { kind: 'text'|'image'|'av', label?, content, mediaType?, mode? }
GET    /api/characters/:id/archives
GET    /api/characters/:id/archives/:aid
PUT    /api/characters/:id/archives/:aid { label?, content? }
DELETE /api/characters/:id/archives/:aid
POST   /api/characters/:id/archives/rebuild

**Chat**
POST   /api/characters/:id/chat          { message }  →  { reply, retrievedCount }
GET    /api/characters/:id/chat/history?limit=50
DELETE /api/characters/:id/chat/history

### What's hardened (v2.0–v2.3)

- **Type-aware, tiered extraction** — image archives use a vision-specific prompt that first identifies who in a screenshot is the character vs. "me" (so the other party's messages aren't misattributed), while text archives use a chat-optimized prompt. A **deep-extraction toggle** lets important archives use a stronger model; `rebuild` always runs deep. Fast/deep models are separately configurable via `LLM_FAST_MODEL` / `LLM_DEEP_MODEL`.
- **Extraction quality validation** — every persona extraction is checked by a dependency-free validator (`src/lib/validate.js`): phantom-phrase detection (a "verbatim" quote that isn't in the source is flagged), verbosity checks, empty/over-extraction checks. Issues are surfaced as an **extraction health score** in the UI. Inspired by olmOCR's principle that structured output should be measured against programmatically verifiable criteria.
- **Persona fidelity benchmark** — `GET /api/characters/:id/eval` runs a held-out evaluation: it parses real (prompt → reply) pairs from the archives, hides the answers, predicts how the persona would reply, and scores prediction vs. truth by embedding cosine similarity. The average is a **fidelity score (0–1)**, gradable A–D. A quantifiable, reproducible answer to "how faithful is this persona?"
- **Async archive processing** — `POST /archives` returns `202` immediately; extraction and embedding run in a per-character background queue. Large uploads no longer block or time out.
- **httpOnly cookie sessions** — tokens no longer stored in `localStorage` (XSS-stealable). `Bearer` header still works for API clients.
- **Batch chunk insertion** — one SQL statement instead of N round-trips; embeddings requested in batches of 64.
- **LLM resilience** — 60s timeout, exponential-backoff retry on 429/5xx, robust JSON parsing.
- **Token-budget history truncation** — long chats never blow the context window.
- **Rebuild concurrency lock**, **crash recovery**, **graceful shutdown**, **helmet**, **DB-aware /health**.
- **CI**: unit + integration (real pgvector) + Docker build + frontend build on every push.

### Known limits (honest, not hidden)

- Archive edits re-extract only that archive; deletion is zero API cost. `POST /rebuild` re-extracts everything.
- Retrieval threshold (0.25) and top-k (6) tunable via `RETRIEVAL_TOP_K` / `RETRIEVAL_MIN_SCORE`.
- No password reset flow yet.
- Screenshots stored as base64 are space-intensive; at scale, store originals in S3/R2.
- The background queue is in-process (no Redis). For multi-instance deployments, swap `src/lib/jobs.js` for BullMQ.

---

## 中文

一个不一样的AI伴侣项目：人设不是写出来的，是从数据里提取出来的。

大部分"AI男友/女友"产品让你填几个性格标签，然后AI照着标签角色扮演——聊久了会发现台词很快见底，人设浮于表面。Companion 反过来做：你喂给它真实、客观的数据（聊天记录、截图、文字记载），系统像训练一个小模型一样，从这些数据里提取这个人的说话风格、常用短语、行为模式，拼出一个更贴近真实的人设模型。数据是活的档案，随时可以查看、编辑、删除，改动后模型自动重新提取——不是一次性写死的设定。

对话时不是把所有记忆硬塞进 prompt，而是用向量检索（RAG）实时找出和当前话题最相关的历史片段注入——这也是为什么它能在数据量很大的情况下依然"记得住细节"。

### 这个项目在做的三件事

**1. 人设 = 数据的提炼，不是描述的堆砌**  
喂入聊天记录/截图 → LLM 提取客观特征（事实、说话风格、逐字原话样本、行为模式）→ 合并进持续更新的人设模型。你不写"温柔""高冷"这种主观形容词，系统自己从数据里总结。

**2. 记忆分两层，各司其职**
- **人设模型**：这个角色是谁——来自你喂的全部档案，可增删改，按档案缓存特征，改动后零API成本重新聚合
- **对话记忆**：这个角色对你的了解——每几轮对话自动提炼一次（事实/情绪/未完话题），像真人一样带着上次对话的余温开始这次

**3. 检索代替硬塞，解决"记不住细节"和存储上限**  
每条数据分块后生成向量存入 pgvector，对话时先检索语义最相关的片段再回答。原始数据全部 AES-256-GCM 加密后存数据库。

### 谁适合用这个

想做的东西超出"填标签聊天"的人：还原一个真实存在过的人（哪怕已经不在了）、基于真实聊天历史训练一个更懂自己的 AI 角色、或者单纯觉得"AI 角色应该从数据里长出来，而不是被描述出来"。

支持任意对话语言，人设语料是什么语言不影响你选择用哪种语言对话。

### 技术架构
喂入数据 ──→ 加密存档 (AES-256-GCM)
│
├──→ 特征提取 (LLM) ──→ persona_model  (人设模型: facts/style/phrases/patterns)
│                              ↑
│                        按档案缓存特征
│                        变动时纯数据库聚合（零 API 成本）
│
└──→ 分块 + embedding ──→ pgvector（语义检索索引）
对话 ──→ 消息向量化 ──→ 检索最相关历史片段 (top-k)
│
└──→ persona_model + 检索片段 + 对话记忆 ──→ LLM ──→ 回复
│
每 3 轮后台提炼对话记忆 (memory)

**技术栈**：Node.js (Express) · PostgreSQL + pgvector · React (Vite) · LLM 与 Embedding 均不限提供商

### API Key 不限提供商

LLM 和 Embedding 都通过环境变量自由配置，不锁死任何一家：

| 用途 | 变量 | 说明 |
|---|---|---|
| 对话/提取 | `LLM_PROVIDER` `LLM_API_KEY` `LLM_BASE_URL` `LLM_MODEL` | `anthropic` 或 `openai`；openai 模式兼容：OpenAI / DeepSeek / OpenRouter / Moonshot / 通义 / 本地 Ollama… |
| 向量 | `EMBEDDING_API_KEY` `EMBEDDING_BASE_URL` `EMBEDDING_MODEL` | 任何 OpenAI 格式 embedding 服务 |

全套换成 DeepSeek + Jina、Claude + Voyage 或本地 Ollama，改环境变量即可，代码零改动。  
⚠️ 换用维度 ≠ 1536 的 embedding 模型时，需同步修改 `db/schema.sql` 的 `vector(1536)`。  
⚠️ 图片档案的转录需要 LLM 支持视觉（Claude 全系 / GPT-4o 等）。

### 快速开始

**方式 A：一条命令（Docker，推荐）**

```bash
./setup.sh          # 检查依赖 → 生成随机密钥 → 启动数据库 → 初始化schema → 跑测试
npm run dev
```

或者整套全用 Docker 跑：

```bash
cp .env.example .env   # 填入 LLM_API_KEY 和 EMBEDDING_API_KEY
docker compose up      # 前端 :5173，后端 :3001，pgvector :5432
```

**方式 B：手动安装**

**1. 数据库（推荐 Supabase 免费档）**

1. 在 [supabase.com](https://supabase.com) 建项目
2. SQL Editor 里运行 `db/schema.sql` 全文
3. 复制 Connection string

**2. 环境变量**

```bash
cp .env.example .env
```

填入 `DATABASE_URL`、`LLM_API_KEY`、`EMBEDDING_API_KEY`，并生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # JWT_SECRET
```

> ⚠️ **立刻备份 `ENCRYPTION_KEY`**——丢失 = 所有已加密数据永久无法解密。部署平台的环境变量值必须和本地 `.env` 完全一致。

**3. 后端**

```bash
npm install
npm run db:init
npm run dev
```

**4. 部署**

Railway / Render / Fly.io 直接连 GitHub 仓库，设好环境变量即可。

**5. 前端（frontend/ 目录）**

```bash
cd frontend
cp .env.example .env    # 填 VITE_API_BASE=你的后端地址
npm install
npm run dev
npm run build
```

### API 一览

所有 `/api/characters` 路由需要 `Authorization: Bearer <token>`。

**认证**
POST /api/auth/register    { email, password }   → { token, user }
POST /api/auth/login       { email, password }   → { token, user }

**角色**
POST   /api/characters                   { name, language }
GET    /api/characters
GET    /api/characters/:id
PATCH  /api/characters/:id               { name?, language? }
GET    /api/characters/:id/eval          →  人设保真度评分（held-out 评估）
GET    /api/characters/:id/export        →  导出为JSON（?full=1 附带解密原文）
DELETE /api/characters/:id

**数据档案**
POST   /api/characters/:id/archives      { kind: 'text'|'image'|'av', label?, content, mediaType?, mode? }
GET    /api/characters/:id/archives
GET    /api/characters/:id/archives/:aid
PUT    /api/characters/:id/archives/:aid { label?, content? }
DELETE /api/characters/:id/archives/:aid
POST   /api/characters/:id/archives/rebuild

**对话**
POST   /api/characters/:id/chat          { message } → { reply, retrievedCount }
GET    /api/characters/:id/chat/history?limit=50
DELETE /api/characters/:id/chat/history

### 工程强化（v2.0–v2.3）

- **分类型、分档提取** — 图片档案用专门的视觉 prompt，先判定截图里谁是角色、谁是「我」，避免把对方的话当成 TA 的；文字档案用针对聊天记录优化的 prompt。新增「深度提取」开关，重要档案可用更强模型，「重建」始终走深度档。快速/深度模型可通过 `LLM_FAST_MODEL` / `LLM_DEEP_MODEL` 分别配置。
- **提取质量验证** — 每次人设提取都会过一层零依赖验证器（`src/lib/validate.js`）：幻觉检测、冗余检测、空/过度提取检测。问题在 UI 里显示为「提取健康度」。灵感来自 olmOCR：结构化输出应该用可程序验证的标准衡量。
- **人设保真度基准** — `GET /api/characters/:id/eval` 跑 held-out 评估：从档案解析真实的「对方一句 → 角色回复」对，藏起答案，用当前人设预测，再用 embedding 余弦相似度打分。平均值即 **fidelity score（0-1）**，分 A–D 等级。给「这个人设到底像不像」一个可量化、可复现的答案。
- **档案异步处理** — `POST /archives` 立刻返回 `202`，后台队列处理。大文件上传不再阻塞或超时。
- **httpOnly cookie 会话** — token 不再存 `localStorage`。
- **分块批量入库**、**LLM 韧性**（60秒超时+重试）、**token 预算截断**、**rebuild 防并发锁**、**崩溃恢复**、**优雅关闭**、**helmet**。
- **CI**：单元 + 集成（真实 pgvector）+ Docker 构建 + 前端构建，每次 push 全跑。

### 已知边界（诚实说明，不是藏起来的坑）

- 档案编辑只重算该条特征，删除零 API 成本。`POST /rebuild` 对全部档案重新提取。
- 检索阈值（0.25）和 top-k（6）可通过环境变量调整。
- 暂无密码找回流程。
- 截图以 base64 存储较占空间；数据量大时建议将原图存 S3/R2。
- 后台队列是进程内实现（不需要 Redis）。多实例部署时可换成 BullMQ。

---

## License

MIT
