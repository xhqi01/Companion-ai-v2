// ============================================================
// 后台任务队列 — 进程内串行执行 + 【DB 持久化, 重启不丢】
//
// v2.3 之前: 队列纯在内存, 进程重启 → 未完成的任务凭空消失,
//   recoverStuckArchives() 只能把卡住的档案标记 error 让用户手动重试。
// v2.4 改进: 昂贵任务(档案处理/重建)先落库成一条 job 记录再执行,
//   进程重启后 resumePendingJobs() 把 queued/running 的 job 重新入队自动跑完。
//   —— 不引入 Redis, 复用现有 Postgres, 零额外基建。
//
// 多实例部署时(单进程扩到多进程)仍建议换 BullMQ:
//   本模块把“调度”与“执行”解耦(handler 注册表), 迁移时只需替换调度层。
// ============================================================
import { q } from "../db.js";

const queues = new Map(); // characterId -> Promise链 (保证同角色串行)

// 任务类型 → 执行函数。由 routes 层在启动时注册, 避免 jobs.js 反向依赖路由(循环引用)。
const handlers = new Map();

/** 注册某类任务的执行器。payload 必须是可 JSON 序列化的纯数据(不能是闭包)。 */
export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

/* ---------- 内部: 把一个已存在的 job 行挂到角色队列尾部执行 ---------- */
function schedule(job) {
  const { id, character_id: characterId, type, payload } = job;
  const tail = queues.get(characterId) || Promise.resolve();
  const next = tail
    .then(async () => {
      const handler = handlers.get(type);
      if (!handler) { console.error(`[jobs] 未注册的任务类型: ${type}`); return; }
      await q("UPDATE jobs SET status='running', attempts=attempts+1, updated_at=now() WHERE id=$1", [id]);
      try {
        await handler(payload);
        await q("UPDATE jobs SET status='done', updated_at=now() WHERE id=$1", [id]);
      } catch (e) {
        console.error(`[jobs] job=${id} type=${type} 失败:`, e.message);
        await q("UPDATE jobs SET status='error', last_error=$2, updated_at=now() WHERE id=$1", [id, String(e.message).slice(0, 500)]);
      }
    })
    .catch((e) => console.error(`[jobs] character=${characterId} 队列异常:`, e.message));
  queues.set(characterId, next);
  next.finally(() => { if (queues.get(characterId) === next) queues.delete(characterId); });
  return next;
}

/**
 * 持久化入队: 先写一条 job 记录(重启可恢复), 再排进内存队列执行。
 * @param {string} characterId
 * @param {string} type  已 registerHandler 的类型
 * @param {object} payload 可序列化的纯数据
 */
export async function enqueueJob(characterId, type, payload = {}) {
  const { rows } = await q(
    "INSERT INTO jobs (character_id, type, payload, status) VALUES ($1,$2,$3,'queued') RETURNING *",
    [characterId, type, JSON.stringify(payload)]
  );
  schedule(rows[0]);
  return rows[0].id;
}

/**
 * 轻量入队(非持久): 仅用于廉价且幂等的操作(如 aggregateModel),
 * 丢了也会在下次档案变更时重算。保留旧签名, 兼容既有调用。
 */
export function enqueue(characterId, taskFn) {
  const tail = queues.get(characterId) || Promise.resolve();
  const next = tail
    .then(() => taskFn())
    .catch((e) => console.error(`[jobs] character=${characterId} 轻量任务失败:`, e.message));
  queues.set(characterId, next);
  next.finally(() => { if (queues.get(characterId) === next) queues.delete(characterId); });
  return next;
}

/* 查询某角色是否有任务在跑(内存队列 + DB 里未完成的 job) */
export async function isBusy(characterId) {
  if (queues.has(characterId)) return true;
  const { rows } = await q(
    "SELECT 1 FROM jobs WHERE character_id=$1 AND status IN ('queued','running') LIMIT 1",
    [characterId]
  );
  return rows.length > 0;
}

/**
 * 启动时恢复: 把上次进程退出时残留的 job 重新跑完。
 *   - queued: 从没开始, 直接重排
 *   - running: 上次跑到一半被杀, 重排重跑(handler 需保证可重入/幂等)
 * 同时清理这些 job 对应档案里卡在 processing 的状态标记。
 */
export async function resumePendingJobs() {
  // 顺手清理: 7天前的已完成/已失败 job, 防止表无限增长(失败的多留几天便于排查)
  await q("DELETE FROM jobs WHERE status IN ('done','error') AND updated_at < now() - interval '7 days'");
  // running 视为中断, 退回 queued
  await q("UPDATE jobs SET status='queued', updated_at=now() WHERE status='running'");
  const { rows } = await q(
    "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC"
  );
  if (rows.length) console.log(`[jobs] 恢复 ${rows.length} 个未完成任务, 重新入队执行`);
  for (const job of rows) schedule(job);
  return rows.length;
}

/**
 * 兼容旧启动流程: 若某些档案 status=processing 但其角色没有任何存活 job(极端情况),
 * 标记为 error 便于用户手动重试。有存活 job 的角色(含 rebuild)由 resumePendingJobs 接管。
 */
export async function recoverStuckArchives() {
  const { rowCount } = await q(
    `UPDATE archives SET status='error', updated_at=now()
     WHERE status='processing'
       AND character_id NOT IN (
         SELECT character_id FROM jobs WHERE status IN ('queued','running')
       )`
  );
  if (rowCount > 0) console.log(`[jobs] ${rowCount} 个无主档案标记为 error, 可重新编辑触发重跑`);
}
