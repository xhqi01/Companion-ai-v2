-- ============================================================
-- Companion 迁移: v2.3 → v2.4
-- 在 Supabase SQL Editor / psql 里整段运行。全部幂等, 可重复执行。
-- 已有数据不受影响。
-- ============================================================

-- #5 用户健康度守护: 记录上次“落地提示”发生的轮数
ALTER TABLE characters ADD COLUMN IF NOT EXISTS last_grounded_at INTEGER NOT NULL DEFAULT 0;

-- #4 图片转录质量: 存转录自评 { confidence, ambiguities }
ALTER TABLE archives ADD COLUMN IF NOT EXISTS transcript_meta JSONB;

-- #3 持久化后台任务: 重启不丢
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'queued',
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_jobs_character ON jobs(character_id);
