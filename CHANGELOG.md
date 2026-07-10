# Changelog

## v2.0 — 工程强化 + 界面重做

### 界面（全新视觉）
- 换掉旧的荧光绿等宽风格，改为奶油纸底 + 莫兰迪低饱和配色（赭陶主色 #B0785C）
- Fraunces 衬线标题 + Inter 正文，私人日记气质
- 圆润对话气泡、纸张颗粒质感、头像按名字生成渐变
- 语言设置移到角色名下方一个清晰的按钮，点开展开整排语言
- 后端地址收进登录页「高级设置」折叠区，普通用户无需关心

### 后端工程
- 档案处理改异步（202 + 后台队列），大文件不再阻塞
- httpOnly cookie 会话，token 不再存 localStorage
- 分块批量入库、embedding 分批请求
- LLM 60s 超时 + 429/5xx 指数退避重试 + 健壮 JSON 解析
- 对话历史 token 预算截断
- rebuild 防并发锁、崩溃恢复、优雅关闭、helmet
- CI：单元 + 集成（真实 pgvector）+ Docker 构建 + 前端构建
- setup.sh 一键安装脚本

## v2.1 — 提取质量验证层

灵感来自 olmOCR：结构化输出的质量应该用可程序验证的标准衡量，而非只靠人工。

- 新增 `src/lib/validate.js`：纯函数验证层，零额外 API 调用
  - 幻觉检测：phrases 声称逐字摘录，必须能在原文找到痕迹
  - 冗余检测：style 描述过长说明在复述而非提炼
  - 空提取 / 过度提取检测：特征数量与数据体量的合理性
- 每个档案提取后自动验证，问题记录进 `archives.quality_issues`
- 角色详情附带「提取健康度」：多少份档案的特征提取无异常
- 前端「人设模型」tab 顶部展示健康度百分比
- db-init.js 增加幂等迁移，旧库自动补列

## v2.2 — 人设保真度评估 (fidelity benchmark)

灵感来自 olmOCR-Bench：给系统一个可量化、可复现的质量基准，而非只靠感觉。

- 新增 `src/lib/eval.js`：held-out 消息预测评估
  - 从档案解析「对方一句 → 角色回复」的真实对话对
  - 留出样本，用当前 persona 模型预测角色会怎么回
  - 预测 vs 真实，embedding 余弦相似度打分，取平均得 fidelity score (0-1)
- 新增 `GET /api/characters/:id/eval` 端点（纯读，不改数据）
- 前端「人设模型」tab 内置「运行评估」：显示分数、等级、逐对预测对比
- 评估等级：A (≥.85) / B (≥.72) / C (≥.55) / D

## v2.3 — 分策略特征提取

针对不同数据类型和重要程度用不同提取策略，提升人设建模质量（六环节流水线里的「特征提取」是整个系统的心脏）。

- 图片档案用专门的视觉提取 prompt：先判定截图里谁是角色、谁是「我」，只提取角色一方，避免把对方的话当成 TA 的
- 文字档案用针对聊天记录优化的 prompt，phrases 强调一字不改的原文摘录
- 新增「深度提取」开关：日常喂数据用快速档（便宜快），重要档案可开深度档（更强模型，更准）
- 「重建」自动用深度档，因为它本就是为提升质量而生
- `LLM_FAST_MODEL` / `LLM_DEEP_MODEL` 两档模型可分别配置，不配则回退到 `LLM_MODEL`

## v2.4 — 自适应检索 + 持久化队列 + 密钥分片 + 转录质检 + 用户健康度

### 检索质量
- 新增 `src/lib/retrieval.js`：top-k 与相似度阈值按角色 chunk 数量自适应
  - 冷启动（数据少）放宽阈值防止检索落空，数据充裕时收紧过滤噪音
  - 显式设置 `RETRIEVAL_TOP_K` / `RETRIEVAL_MIN_SCORE` 仍作为硬边界，回退固定策略
- 新增 `GET /:id/retrieval-sweep`：用角色真实对话语料扫描各候选阈值的召回率，给出推荐值
- 对话响应附带 `retrievalTier`（cold/growing/rich）便于观察

### 后台任务持久化（重启不丢）
- `src/lib/jobs.js` 重写：昂贵任务（档案处理/重建）先落库 `jobs` 表再执行
  - 进程重启后 `resumePendingJobs()` 自动续跑，不再只标 error 等用户手动重试
  - handler 注册表解耦调度与执行，多实例部署时可平滑替换为 BullMQ
  - 不引入 Redis，复用现有 Postgres，零额外基建
- 启动时自动清理 7 天前的已完成 job，表不会无限增长

### 密钥抗灾备份
- 新增 `src/lib/keyshares.js`：Shamir's Secret Sharing over GF(256)，纯 JS 零依赖
  - `npm run key:split` 把 ENCRYPTION_KEY 拆成 N 份（默认 3-of-5），任意阈值份数可重建
  - 单份泄露零信息（信息论安全），运行时加解密逻辑完全不变
- 新增 `scripts/key-shares.js` CLI（split / combine）

### 图片转录质检
- 图片转录改为结构化输出：`{ transcript, confidence, ambiguities }`，视觉模型自评转录质量
- 低置信（< `TRANSCRIPT_MIN_CONFIDENCE`，默认 0.6）或有歧义 → 写入 `quality_issues` 提示复核
  - 防止误读的截图内容被"固化"进 persona_model
- 档案列表接口返回 `quality_issues`，详情接口返回 `transcriptMeta`

### 用户健康度守护
- 新增 `src/lib/wellbeing.js`：检测强依恋/现实混淆信号（中英日）
  - 低频触发（默认每 24 轮上限一次），让角色用自己的口吻温柔落地"我是从数据里被重建的"
  - 不弹窗、不出戏、不说教；`WELLBEING_GROUNDING=off` 可整体关闭
- 产品立场：重建逝去的人有真实价值，但使用者的现实感同样值得被守护

### 其他
- 修复：编辑图片档案时重新处理的是旧内容而非新内容
- 修复：重建中途重启会把档案误标 error 的状态闪烁
- db-init.js 补全 v2.4 幂等迁移（`jobs` 表、`last_grounded_at`、`transcript_meta`）
- 新增单测：keyshares / retrieval / wellbeing（共 +10 用例）
