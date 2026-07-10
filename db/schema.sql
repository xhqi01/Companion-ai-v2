-- ============================================================
-- Companion Backend Schema (PostgreSQL + pgvector)
-- 在 Supabase SQL Editor 或 psql 里直接运行整个文件
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 用户
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 角色（属于某个用户）
CREATE TABLE IF NOT EXISTS characters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'zh',      -- 对话语言，任意语言代码/名称
  persona_model JSONB NOT NULL DEFAULT '{"facts":[],"style":[],"phrases":[],"patterns":[]}',
  memory        JSONB NOT NULL DEFAULT '{"facts":[],"patterns":[],"emotions":"","threads":[]}',
  msg_count     INTEGER NOT NULL DEFAULT 0,
  last_grounded_at INTEGER NOT NULL DEFAULT 0,  -- 上次“落地提示”发生在第几轮(用户健康度守护, 见 lib/wellbeing.js)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);

-- 数据档案：每次喂入 = 一条记录，原始内容 AES-256-GCM 加密存储
CREATE TABLE IF NOT EXISTS archives (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('text','image','av')),
  label         TEXT NOT NULL DEFAULT '',
  content_enc   TEXT NOT NULL,                   -- 加密后的原始内容 (iv:tag:ciphertext, base64)
  media_type    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'processing', -- processing | done | error | pending_transcript
  features      JSONB,                           -- 该档案单独提取的特征缓存(增量聚合用)
  quality_issues JSONB DEFAULT '[]'::jsonb,       -- 提取质量验证发现的问题(幻觉/冗余/空/过度提取/低置信转录)
  transcript_meta JSONB,                          -- 图片档案的转录自评: { confidence, ambiguities } (见 routes/archives.js)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_archives_character ON archives(character_id);

-- 记忆分块 + 向量：RAG 检索的核心
CREATE TABLE IF NOT EXISTS chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  archive_id    UUID NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  content_enc   TEXT NOT NULL,                   -- 加密后的分块文本
  embedding     vector(1536) NOT NULL,           -- text-embedding-3-small
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunks_character ON chunks(character_id);
-- 向量索引（数据量大时显著加速；小数据量可省略）
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops);

-- 对话消息
CREATE TABLE IF NOT EXISTS messages (
  id            BIGSERIAL PRIMARY KEY,
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content_enc   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_character ON messages(character_id, id);

-- 持久化后台任务：昂贵任务(档案处理/重建)落库, 进程重启后自动续跑(见 lib/jobs.js)
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                   -- process_archive | rebuild
  payload       JSONB NOT NULL DEFAULT '{}',     -- 可序列化的纯数据(如 { archiveId })
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | error
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_jobs_character ON jobs(character_id);
