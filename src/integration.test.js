// 集成测试: 注册 → 登录 → 建角色 → 权限隔离
// 需要环境变量 DATABASE_URL 指向可用的测试库 (CI里由postgres service提供)
// 本地跑: docker compose up db -d && DATABASE_URL=postgres://companion:companion_dev@localhost:5432/companion npm run test:integration
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret_at_least_32_characters_long_xx";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
process.env.PORT = "3999";
process.env.NODE_ENV = "test";

const BASE = "http://localhost:3999";
const email = `test-${Date.now()}@example.com`;
const password = "password123";
let server;
let cookie = "";

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

describe("集成: 认证与权限隔离", () => {
  before(async () => {
    const mod = await import("./index.js");
    // 等server ready
    await new Promise((r) => setTimeout(r, 500));
  });

  it("健康检查含数据库连通性", async () => {
    const { status, data } = await req("/health");
    assert.equal(status, 200);
    assert.equal(data.db, true);
  });

  it("注册返回用户信息并写入 session cookie", async () => {
    const { status, data } = await req("/api/auth/register", { method: "POST", body: { email, password } });
    assert.equal(status, 200);
    assert.equal(data.user.email, email);
    assert.ok(cookie.includes("cp_session"));
  });

  it("弱密码被拒绝", async () => {
    const { status } = await req("/api/auth/register", { method: "POST", body: { email: "x@y.com", password: "123" } });
    assert.equal(status, 400);
  });

  it("cookie 会话可通过 /me 验证", async () => {
    const { status, data } = await req("/api/auth/me");
    assert.equal(status, 200);
    assert.equal(data.email, email);
  });

  it("未登录访问角色列表返回 401", async () => {
    const saved = cookie; cookie = "";
    const { status } = await req("/api/characters");
    assert.equal(status, 401);
    cookie = saved;
  });

  it("创建角色并列出", async () => {
    const { status, data } = await req("/api/characters", { method: "POST", body: { name: "测试角色", language: "中文" } });
    assert.equal(status, 200);
    assert.equal(data.name, "测试角色");
    const list = await req("/api/characters");
    assert.ok(list.data.some((c) => c.id === data.id));
  });

  it("logout 后 session 失效", async () => {
    await req("/api/auth/logout", { method: "POST" });
    cookie = "";
    const { status } = await req("/api/auth/me");
    assert.equal(status, 401);
  });

  after(() => process.exit(0));
});
