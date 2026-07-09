// 轻量后台任务队列 — 进程内串行执行, 无需Redis
// 用途: 档案处理(特征提取+向量索引)不阻塞HTTP请求
// 设计:
//   - 每个character一条队列(同角色任务串行, 避免聚合竞态)
//   - 不同角色并行
//   - 进程重启后, 卡在processing的档案由 recoverStuckArchives() 标记为error
import { q } from "../db.js";

const queues = new Map(); // characterId -> Promise链

/* 把任务挂到指定角色的队列尾部, 立刻返回(不等待执行) */
export function enqueue(characterId, taskFn) {
  const tail = queues.get(characterId) || Promise.resolve();
  const next = tail
    .then(() => taskFn())
    .catch((e) => console.error(`[jobs] character=${characterId} 任务失败:`, e.message));
  queues.set(characterId, next);
  // 队列空闲后清理, 防止Map无限增长
  next.finally(() => {
    if (queues.get(characterId) === next) queues.delete(characterId);
  });
  return next;
}

/* 查询某角色是否有任务在跑 */
export const isBusy = (characterId) => queues.has(characterId);

/* 启动时恢复: 上次进程退出时卡在processing的档案 → 标记error, 提示用户重试 */
export async function recoverStuckArchives() {
  const { rowCount } = await q(
    "UPDATE archives SET status='error', updated_at=now() WHERE status='processing'"
  );
  if (rowCount > 0) console.log(`[jobs] 恢复: ${rowCount} 个中断的档案已标记为error, 可通过重新编辑触发重跑`);
}
