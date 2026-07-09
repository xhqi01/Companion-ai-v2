#!/usr/bin/env bash
# ============================================================
# Companion 一键安装脚本
# 用法: ./setup.sh
# 前置: 已安装 Docker 与 Node.js 20+
# ============================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}▸ Companion 一键安装${NC}"

# 1. 检查依赖
command -v docker >/dev/null 2>&1 || { echo "❌ 需要安装 Docker: https://docs.docker.com/get-docker/"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ 需要安装 Node.js 20+: https://nodejs.org/"; exit 1; }
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
[ "$NODE_MAJOR" -ge 20 ] || { echo "❌ Node.js 版本需要 >= 20, 当前: $(node -v)"; exit 1; }

# 2. 生成 .env（已存在则跳过）
if [ ! -f .env ]; then
  echo -e "${GREEN}▸ 生成 .env（自动生成随机密钥）${NC}"
  cp .env.example .env
  JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  ENC=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  # 跨平台 sed（macOS/Linux）
  sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=$JWT/" .env && rm -f .env.bak
  sed -i.bak "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENC/" .env && rm -f .env.bak
  echo -e "${YELLOW}⚠ 请编辑 .env 填入你的 LLM API key（ANTHROPIC_API_KEY 或 OPENAI_API_KEY）和 EMBEDDING_API_KEY${NC}"
else
  echo -e "${GREEN}▸ .env 已存在，跳过${NC}"
fi

# 3. 安装依赖
echo -e "${GREEN}▸ 安装后端依赖${NC}"
npm ci 2>/dev/null || npm install

# 4. 启动数据库
echo -e "${GREEN}▸ 启动 PostgreSQL (pgvector)${NC}"
docker compose up db -d

# 等待数据库就绪
echo -e "${GREEN}▸ 等待数据库就绪...${NC}"
for i in $(seq 1 30); do
  docker compose exec -T db pg_isready -U companion >/dev/null 2>&1 && break
  sleep 1
done

# 5. 初始化schema（docker-entrypoint已挂载schema.sql, 但重复执行也安全）
echo -e "${GREEN}▸ 初始化数据库 schema${NC}"
DATABASE_URL=postgres://companion:companion_dev@localhost:5432/companion DATABASE_SSL=false node src/db-init.js

# 6. 跑单元测试验证
echo -e "${GREEN}▸ 运行单元测试${NC}"
npm test

echo ""
echo -e "${GREEN}✅ 安装完成！${NC}"
echo ""
echo "下一步:"
echo "  1. 编辑 .env 填入 API keys"
echo "  2. 启动后端:  npm run dev"
echo "  3. 启动前端:  cd frontend && npm install && npm run dev"
echo "  4. 打开浏览器: http://localhost:5173"
echo ""
echo "或者全部用 Docker: docker compose up"
