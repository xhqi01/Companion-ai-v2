# Companion

![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white) ![React](https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=black) ![License](https://img.shields.io/badge/license-MIT-blue) ![LLM](https://img.shields.io/badge/LLM-provider--agnostic-8A2BE2)

**English** · [中文](#中文) · [日本語](#日本語)

---

## English

A different kind of AI companion: the persona isn't written — it's extracted from data.

Most AI companion products ask you to fill in personality tags, and the AI roleplays from those tags. After a while, the script runs dry and the persona feels thin. Companion works the other way: you feed it real, objective data (chat logs, screenshots, written records), and the system — like training a small model — extracts that person's speech style, common phrases, and behavioral patterns to build a persona model that's closer to who they actually are. The data lives as editable archives: view, edit, or delete any entry at any time, and the model re-extracts automatically. Nothing is written in stone.

During conversation, instead of stuffing all memory into the prompt, Companion uses vector search (RAG) to retrieve the most semantically relevant historical fragments in real time. That's why it can still "remember details" even when the data grows large — instead of getting vague when things pile up.

### Screenshots

<!-- TODO: 把前端跑起来后截 2-3 张图放到 docs/screenshots/ 目录，然后取消下面的注释。
     推荐：① 聊天界面 ② 人设模型可视化面板 ③ 档案管理面板 -->
<!--
<p align="center">
  <img src="docs/screenshots/chat.png" width="70%" alt="Chat interface" />
</p>
<p align="center">
  <img src="docs/screenshots/persona-model.png" width="45%" alt="Persona model panel" />
  <img src="docs/screenshots/archives.png" width="45%" alt="Archive management" />
</p>
-->

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

```
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
```

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

> ⚠️ **Back up `ENCRYPTION_KEY` immediately** — store it in a password manager (1Password, Bitwarden, etc.). If it's lost, all encrypted data is permanently unrecoverable. This is a property of encryption, not a bug. Make sure the value in your deployment platform's environment variables matches your local `.env` exactly — a mismatch means data written in production can't be read locally.  
> `JWT_SECRET` loss is less severe (users just log in again), but don't commit it to git either.

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

The frontend includes: login / register, character list (20+ language selector + custom language, switchable anytime), data archive panel (upload / paste / edit / delete), persona model and conversation memory visualization, and the chat interface. The backend URL is set on the login page, so one frontend build can connect to any deployed backend.

### API reference

All `/api/characters` routes require `Authorization: Bearer <token>`.

**Auth**
```
POST /api/auth/register    { email, password }  →  { token, user }   # password ≥ 8 chars, bcrypt
POST /api/auth/login       { email, password }  →  { token, user }   # token valid 7 days
```
Data is fully isolated per user. Cross-user access returns 404.

**Characters**
```
POST   /api/characters                   { name, language }
GET    /api/characters
GET    /api/characters/:id
PATCH  /api/characters/:id               { name?, language? }
GET    /api/characters/:id/export        →  persona model + memory + archive list as downloadable JSON (?full=1 adds decrypted text archive contents)
DELETE /api/characters/:id
```

**Archives** (each feed = one encrypted, editable archive)
```
POST   /api/characters/:id/archives      { kind: 'text'|'image'|'av', label?, content, mediaType? }
GET    /api/characters/:id/archives
GET    /api/characters/:id/archives/:aid
PUT    /api/characters/:id/archives/:aid { label?, content? }
DELETE /api/characters/:id/archives/:aid
POST   /api/characters/:id/archives/rebuild
```

**Chat**
```
POST   /api/characters/:id/chat          { message }  →  { reply, retrievedCount }
GET    /api/characters/:id/chat/history?limit=50
DELETE /api/characters/:id/chat/history
```

### What's hardened in v2.0

- **Async archive processing** — `POST /archives` returns `202` immediately; feature extraction and embedding run in a per-character background queue (serial per character to avoid aggregation races, parallel across characters). Frontend polls status. Large uploads no longer block or time out HTTP requests.
- **httpOnly cookie sessions** — tokens are no longer stored in `localStorage` (XSS-stealable). Sessions ride in `httpOnly` cookies; `Bearer` header still works for API clients and scripts.
- **Batch chunk insertion** — one SQL statement instead of N round-trips; embeddings requested in batches of 64.
- **LLM resilience** — 60s timeout, exponential-backoff retry on 429/5xx, and JSON parsing that survives LLMs wrapping output in prose.
- **Token-budget history truncation** — conversation history is trimmed to a configurable token budget (`HISTORY_TOKEN_BUDGET`) so long chats never blow the context window.
- **Rebuild concurrency lock** — `POST /rebuild` is rejected with `409` while the character already has jobs running.
- **Crash recovery** — archives stuck in `processing` after a process restart are marked `error` on boot for easy retry.
- **Graceful shutdown, `helmet`, DB-aware `/health`** — production-ready process hygiene.
- **CI: unit + integration (real pgvector database) + Docker build + frontend build**, all on every push.

### Known limits (honest, not hidden)

- Archive edits re-extract only that archive's features; deletion is zero API cost. `POST /rebuild` re-extracts everything — use it only when upgrading the extraction logic.
- Retrieval threshold (0.25) and top-k (6) are tunable via `RETRIEVAL_TOP_K` and `RETRIEVAL_MIN_SCORE` env vars.
- No password reset flow yet.
- Screenshots stored as base64 are space-intensive; at scale, store originals in Supabase Storage / S3 / R2 and keep only the transcript text in the database.
- The background queue is in-process (no Redis needed, zero extra infra) — jobs don't survive restarts, but crash recovery marks them for retry. For multi-instance deployments, swap `src/lib/jobs.js` for BullMQ.

---

## 中文

一个不一样的AI伴侣项目：人设不是写出来的，是从数据里提取出来的。

大部分"AI男友/女友"产品让你填几个性格标签，然后AI照着标签角色扮演——聊久了会发现台词很快见底，人设浮于表面。Companion 反过来做：你喂给它真实、客观的数据（聊天记录、截图、文字记载），系统像训练一个小模型一样，从这些数据里提取这个人的说话风格、常用短语、行为模式，拼出一个更贴近真实的人设模型。数据是活的档案，随时可以查看、编辑、删除，改动后模型自动重新提取——不是一次性写死的设定。

对话时不是把所有记忆硬塞进 prompt，而是用向量检索（RAG）实时找出和当前话题最相关的历史片段注入——这也是为什么它能在数据量很大的情况下依然"记得住细节"，而不会一多就语焉不详。

### 这个项目在做的三件事

**1. 人设 = 数据的提炼，不是描述的堆砌**  
喂入聊天记录/截图 → LLM 提取客观特征（事实、说话风格、逐字原话样本、行为模式）→ 合并进持续更新的人设模型。你不写"温柔""高冷"这种主观形容词，系统自己从数据里总结。

**2. 记忆分两层，各司其职**
- **人设模型**：这个角色是谁——来自你喂的全部档案，可增删改，按档案缓存特征，改动后零API成本重新聚合
- **对话记忆**：这个角色对你的了解——每几轮对话自动提炼一次（事实/情绪/未完话题），像真人一样带着上次对话的余温开始这次

**3. 检索代替硬塞，解决"记不住细节"和存储上限**  
每条数据分块后生成向量存入 pgvector，对话时先检索语义最相关的片段再回答，而不是指望一个越堆越大的 JSON 装下一切。原始数据全部 AES-256-GCM 加密后存数据库，不再受浏览器端存储的容量限制。

### 谁适合用这个

想做的东西超出"填标签聊天"的人：还原一个真实存在过的人（哪怕已经不在了）、基于真实聊天历史训练一个更懂自己的 AI 角色、或者单纯觉得"AI 角色应该从数据里长出来，而不是被描述出来"。

支持任意对话语言，人设语料是什么语言不影响你选择用哪种语言对话。

### 技术架构

```
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
```

**技术栈**：Node.js (Express) · PostgreSQL + pgvector · React (Vite) · LLM 与 Embedding 均不限提供商

### API Key 不限提供商

LLM 和 Embedding 都通过环境变量自由配置，不锁死任何一家：

| 用途 | 变量 | 说明 |
|---|---|---|
| 对话/提取 | `LLM_PROVIDER` `LLM_API_KEY` `LLM_BASE_URL` `LLM_MODEL` | `anthropic` 或 `openai`；openai 模式兼容：OpenAI / DeepSeek / OpenRouter / Moonshot / 通义 / 本地 Ollama… |
| 向量 | `EMBEDDING_API_KEY` `EMBEDDING_BASE_URL` `EMBEDDING_MODEL` | 任何 OpenAI 格式 embedding 服务（OpenAI / Voyage / Jina / 本地…） |

全套换成 DeepSeek + Jina、Claude + Voyage 或本地 Ollama，改环境变量即可，代码零改动。  
⚠️ 换用维度 ≠ 1536 的 embedding 模型时，需同步修改 `db/schema.sql` 的 `vector(1536)`。  
⚠️ 图片档案的转录需要 LLM 支持视觉（Claude 全系 / GPT-4o 等具备；纯文本模型喂图片会失败，文字档案不受影响）。

### 快速开始

**方式 A：一条命令（Docker，推荐）**

```bash
./setup.sh          # 检查依赖 → 生成随机密钥 → 启动数据库 → 初始化schema → 跑测试
# 然后编辑 .env 填入 API keys，再:
npm run dev
```

或者整套（数据库 + 后端 + 前端）全用 Docker 跑：

```bash
cp .env.example .env   # 填入 LLM_API_KEY 和 EMBEDDING_API_KEY
docker compose up      # 前端 :5173，后端 :3001，pgvector :5432
```

**方式 B：手动安装**

**1. 数据库（推荐 Supabase 免费档）**

1. 在 [supabase.com](https://supabase.com) 建项目
2. SQL Editor 里运行 `db/schema.sql` 全文（含 pgvector 扩展启用）
3. Project Settings → Database 复制 Connection string

**2. 环境变量**

```bash
cp .env.example .env
```

填入 `DATABASE_URL`、`LLM_API_KEY`、`EMBEDDING_API_KEY`，并生成密钥：

```bash
# ENCRYPTION_KEY（64 位 hex）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# JWT_SECRET（至少 32 字符）
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> ⚠️ **立刻备份 `ENCRYPTION_KEY`**——存进密码管理器（1Password / Bitwarden）。丢失 = 所有已加密数据永久无法解密，这是加密的物理属性，任何代码都救不回来。部署平台的环境变量值必须和本地 `.env` 完全一致——两边不一致会导致线上写的数据本地读不了。  
> `JWT_SECRET` 丢失影响较小（所有用户重新登录即可），但同样不要提交进 git。

**3. 后端**

```bash
npm install
npm run db:init   # 已手动运行 schema.sql 可跳过
npm run dev
```

**4. 部署**

Railway / Render / Fly.io 直接连 GitHub 仓库，设好环境变量即可，`PORT` 由平台自动注入。

**5. 前端（frontend/ 目录）**

```bash
cd frontend
cp .env.example .env    # 填 VITE_API_BASE=你的后端地址
npm install
npm run dev             # 本地开发
npm run build           # 产物在 dist/，部署到 Vercel/Netlify/Cloudflare Pages
```

前端已含：登录/注册页、角色列表（20+ 语言选择器 + 自定义语言，随时切换）、数据档案面板（上传/粘贴/编辑/删除）、人设模型与对话记忆可视化、对话界面。登录页可直接填后端地址，同一份前端可连任意部署的后端。

### API 一览

所有 `/api/characters` 路由需要请求头 `Authorization: Bearer <token>`。

**认证**
```
POST /api/auth/register    { email, password }   → { token, user }   # 密码≥8位, bcrypt 哈希存储
POST /api/auth/login       { email, password }   → { token, user }   # token 有效期 7 天
```
数据完全按用户隔离：角色/档案/对话只有所有者可见，跨用户访问一律 404。

**角色**
```
POST   /api/characters                   { name, language }
GET    /api/characters
GET    /api/characters/:id
PATCH  /api/characters/:id               { name?, language? }
GET    /api/characters/:id/export        →  人设模型 + 对话记忆 + 档案清单，导出为可下载JSON（?full=1 附带文本档案解密原文）
DELETE /api/characters/:id
```

**数据档案（每次喂入 = 一个可编辑的加密档案）**
```
POST   /api/characters/:id/archives      { kind: 'text'|'image'|'av', label?, content, mediaType? }
GET    /api/characters/:id/archives
GET    /api/characters/:id/archives/:aid
PUT    /api/characters/:id/archives/:aid { label?, content? }
DELETE /api/characters/:id/archives/:aid
POST   /api/characters/:id/archives/rebuild
```

**对话**
```
POST   /api/characters/:id/chat          { message } → { reply, retrievedCount }
GET    /api/characters/:id/chat/history?limit=50
DELETE /api/characters/:id/chat/history
```

### v2.0 工程强化

- **档案异步处理** — `POST /archives` 立刻返回 `202`，特征提取和向量化在按角色隔离的后台队列执行（同角色串行防聚合竞态，跨角色并行），前端轮询状态。大文件上传不再阻塞或超时。
- **httpOnly cookie 会话** — token 不再存 `localStorage`（可被 XSS 窃取），改由 `httpOnly` cookie 承载；`Bearer` 头继续支持 API 客户端和脚本。
- **分块批量入库** — 单条 SQL 批量 INSERT 替代 N 次往返；embedding 按 64 条/批请求。
- **LLM 韧性** — 60 秒超时、429/5xx 指数退避重试、能容忍 LLM 输出带前后废话的 JSON 解析。
- **对话历史 token 预算截断** — 长对话永远不会超出模型 context window（`HISTORY_TOKEN_BUDGET` 可调）。
- **rebuild 防并发锁** — 该角色有任务在跑时返回 `409`。
- **崩溃恢复** — 进程重启后卡在 `processing` 的档案自动标记 `error` 便于重试。
- **优雅关闭、`helmet`、带数据库连通性的 `/health`** — 生产级进程管理。
- **CI：单元测试 + 集成测试（真实 pgvector 数据库）+ Docker 构建验证 + 前端构建验证**，每次 push 全跑。

### 已知边界（诚实说明，不是藏起来的坑）

- 档案编辑只重算该条特征，删除零 API 成本。`POST /rebuild` 对全部档案重新提取——仅在提取逻辑升级后使用。
- 检索阈值（0.25）和 top-k（6）可通过环境变量 `RETRIEVAL_MIN_SCORE` / `RETRIEVAL_TOP_K` 调整。
- 暂无密码找回流程。
- 截图以 base64 存储较占空间；数据量大时建议将原图存 Supabase Storage / S3 / R2，数据库只保留转录文本。
- 后台队列是进程内实现（不需要 Redis，零额外基建）——任务不跨重启存活，但崩溃恢复机制会标记待重试。多实例部署时可把 `src/lib/jobs.js` 换成 BullMQ。

---

## 日本語

AIコンパニオンの新しいアプローチ：ペルソナは書くのではなく、データから抽出する。

多くのAIコンパニオン製品は「優しい・穏やか・コーヒーが好き」といった性格タグを入力させ、AIはそのタグに従ってロールプレイします。しばらく使うと台本が尽き、ペルソナが薄っぺらく感じられます。Companion は逆のアプローチを取ります：実際のデータ（チャット履歴、スクリーンショット、書き起こし）を与えると、システムが小さなモデルを学習させるように、その人の話し方・口癖・行動パターンを自動で抽出し、より本物に近いペルソナモデルを構築します。データは編集可能なアーカイブとして生き続け、いつでも閲覧・編集・削除でき、変更後はモデルが自動再抽出します。

会話中は全ての記憶をプロンプトに詰め込むのではなく、ベクトル検索（RAG）で現在の話題に最も意味的に関連する過去の断片をリアルタイムで検索・注入します。データが大量になっても「細部を覚えている」理由がこれです。

### このプロジェクトがやること

**1. ペルソナ = データの蒸留、説明の積み重ねではない**  
チャット履歴・スクリーンショットを投入 → LLM が客観的な特徴（事実、話し方、逐語的なフレーズサンプル、行動パターン）を抽出 → 継続的に更新されるペルソナモデルにマージ。「優しい」「クール」といった主観的な形容詞を書く必要はなく、システムがデータから自動で導き出します。

**2. 2層の記憶構造、それぞれの役割**
- **ペルソナモデル**：このキャラクターが誰か——全アーカイブから構築、編集可能、変更時はAPIコストゼロで再集計
- **会話記憶**：キャラクターが*あなた*について知っていること——数ターンごとに自動蒸留（事実/感情/未解決トピック）、前回の会話の余韻を持って始まる

**3. 詰め込みではなく検索——「細部を覚えられない」と容量制限を解決**  
全データはチャンク分割後にベクトル化してpgvectorに保存。推論時は意味的に最も関連するチャンクを検索してから回答します。全Raw データはAES-256-GCMで暗号化してDBに保存——ブラウザのストレージ制限はありません。

### 向いている人

「タグを埋めてチャット」を超えたものを作りたい人：実在した人物の再現（たとえ亡くなっていても）、実際のチャット履歴からより自分を理解するAIキャラクターの訓練、あるいは単純に「AIペルソナはデータから育つべきで、描写で作るものではない」と思っている人。

任意の言語での会話をサポート。学習データの言語は会話言語の選択に影響しません。

### アーキテクチャ

```
データ投入 ──→ 暗号化アーカイブ (AES-256-GCM)
    │
    ├──→ 特徴抽出 (LLM) ──→ persona_model  { facts, style, phrases, patterns }
    │                              ↑
    │                        アーカイブ単位でキャッシュ
    │                        変更時はDB集計のみ（APIコストなし）
    │
    └──→ チャンク分割 + embedding ──→ pgvector インデックス

会話 ──→ メッセージのベクトル化 ──→ 意味検索 (top-k)
              │
              └──→ persona_model + 検索チャンク + 会話記憶 ──→ LLM ──→ 返答
                                                    │
                                        3ターンごとに記憶を蒸留
```

**技術スタック**：Node.js (Express) · PostgreSQL + pgvector · React (Vite) · LLM・Embedding ともにプロバイダー非依存

### APIプロバイダーは自由

環境変数で自由に設定、ベンダーロックインなし：

| 用途 | 変数 | 説明 |
|---|---|---|
| 会話・抽出 | `LLM_PROVIDER` `LLM_API_KEY` `LLM_BASE_URL` `LLM_MODEL` | `anthropic` または `openai`；openaiモードはOpenAI / DeepSeek / OpenRouter / Moonshot / Qwen / ローカルOllamaなどに対応 |
| Embedding | `EMBEDDING_API_KEY` `EMBEDDING_BASE_URL` `EMBEDDING_MODEL` | OpenAI形式のEmbeddingサービスならどれでも可 |

DeepSeek + Jina、Claude + Voyage、ローカルOllamaへの完全切り替えも環境変数の変更のみ、コード変更ゼロ。  
⚠️ 次元数が1536以外のEmbeddingモデルに変更する場合は、`db/schema.sql` の `vector(1536)` も変更してください。  
⚠️ 画像アーカイブの書き起こしにはビジョン対応モデルが必要（Claude、GPT-4oなど）。テキストアーカイブはどのモデルでも動作します。

### クイックスタート

**1. データベース（Supabase無料プラン推奨）**

1. [supabase.com](https://supabase.com) でプロジェクト作成
2. SQL Editorで `db/schema.sql` を全文実行（pgvector拡張を有効化）
3. Project Settings → Database から接続文字列をコピー

**2. 環境変数**

```bash
cp .env.example .env
```

`DATABASE_URL`・`LLM_API_KEY`・`EMBEDDING_API_KEY` を記入し、キーを生成：

```bash
# ENCRYPTION_KEY（64文字のhex）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# JWT_SECRET（32文字以上）
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> ⚠️ **`ENCRYPTION_KEY` はすぐにバックアップしてください**——パスワードマネージャー（1Password、Bitwarden）に保存。紛失した場合、暗号化済みデータは永久に復号不可能です。デプロイ環境の環境変数とローカルの `.env` の値が一致していないと、本番で書いたデータをローカルで読めなくなります。  
> `JWT_SECRET` の紛失はそれほど深刻ではありません（ユーザーが再ログインするだけ）が、gitにはコミットしないでください。

**3. バックエンド**

```bash
npm install
npm run db:init   # schema.sqlを手動実行済みの場合はスキップ
npm run dev
```

**4. デプロイ**

Railway / Render / Fly.io にGitHubリポジトリを接続し、環境変数を設定するだけ。`PORT` はプラットフォームが自動注入します。

**5. フロントエンド（`frontend/` ディレクトリ）**

```bash
cd frontend
cp .env.example .env    # VITE_API_BASE にバックエンドのURLを設定
npm install
npm run dev             # ローカル開発
npm run build           # dist/ に出力、Vercel/Netlify/Cloudflare Pagesにデプロイ
```

フロントエンドに含まれるもの：ログイン/登録ページ、キャラクター一覧（20以上の言語セレクター＋カスタム言語、いつでも切り替え可能）、データアーカイブパネル（アップロード/貼り付け/編集/削除）、ペルソナモデルと会話記憶の可視化、チャットインターフェース。ログインページでバックエンドURLを指定するため、1つのフロントエンドビルドでどのバックエンドにも接続できます。

### API一覧

全ての `/api/characters` ルートは `Authorization: Bearer <token>` ヘッダーが必要です。

**認証**
```
POST /api/auth/register    { email, password }  →  { token, user }   # パスワード8文字以上、bcryptハッシュ
POST /api/auth/login       { email, password }  →  { token, user }   # token有効期限7日
```
データはユーザー単位で完全分離。クロスユーザーアクセスは404を返します。

**キャラクター**
```
POST   /api/characters                   { name, language }
GET    /api/characters
GET    /api/characters/:id
PATCH  /api/characters/:id               { name?, language? }
GET    /api/characters/:id/export        →  ペルソナモデル + 会話記憶 + アーカイブ一覧をJSONでダウンロード（?full=1 でテキストアーカイブの復号済み原文も含む）
DELETE /api/characters/:id
```

**アーカイブ（毎回の投入 = 1つの暗号化済み編集可能アーカイブ）**
```
POST   /api/characters/:id/archives      { kind: 'text'|'image'|'av', label?, content, mediaType? }
GET    /api/characters/:id/archives
GET    /api/characters/:id/archives/:aid
PUT    /api/characters/:id/archives/:aid { label?, content? }
DELETE /api/characters/:id/archives/:aid
POST   /api/characters/:id/archives/rebuild
```

**チャット**
```
POST   /api/characters/:id/chat          { message }  →  { reply, retrievedCount }
GET    /api/characters/:id/chat/history?limit=50
DELETE /api/characters/:id/chat/history
```

### 既知の制限（正直な説明、隠れた落とし穴ではありません）

- アーカイブ編集はその1件のみ再抽出、削除はAPIコストゼロ。`POST /rebuild` は全アーカイブを再抽出——抽出ロジックをアップグレードした時のみ使用してください。
- 検索の閾値（0.25）とtop-k（6）は環境変数 `RETRIEVAL_MIN_SCORE` / `RETRIEVAL_TOP_K` で調整可能。
- パスワードリセット機能は未実装（予定）。
- スクリーンショットをbase64で保存するとストレージを圧迫します。大規模運用時はSupabase Storageに原画像を保存し、DBには書き起こしテキストのみ保持することを推奨します。

---

## License

MIT
