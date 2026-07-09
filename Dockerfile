FROM node:20-alpine

WORKDIR /app

# 只先复制 package 文件，利用 Docker 层缓存
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
