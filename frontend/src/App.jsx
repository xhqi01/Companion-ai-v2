import { useState, useEffect, useRef, useCallback } from "react";
import { S, serif, sans, avatarGradient } from "./theme.js";

/* ============================================================
   Companion Frontend — 登录 + 角色管理 + 档案喂养 + RAG对话
   视觉：奶油纸底 + 莫兰迪 + 衬线标题（私人日记气质）
   鉴权：httpOnly cookie（credentials: include）
   ============================================================ */

const LANGUAGES = ["中文", "English", "日本語", "한국어", "Español", "Français", "Deutsch", "Português", "Italiano", "Русский", "العربية", "हिन्दी", "ไทย", "Tiếng Việt", "Bahasa Indonesia", "Türkçe", "Nederlands", "Polski", "Svenska", "Українська"];
const DEFAULT_API = import.meta.env.VITE_API_BASE || "http://localhost:3001";

/* ---------- API 客户端（cookie 鉴权，token 不落 localStorage） ---------- */
function makeApi(base, onUnauthorized) {
  return async (path, opts = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...opts,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };
}

const fmtDate = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};
const fmtDateTime = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function App() {
  const [apiBase, setApiBase] = useState(() => localStorage.getItem("cp:apiBase") || DEFAULT_API);
  const [authed, setAuthed] = useState(null); // null=检查中 false=未登录 true=已登录
  const [character, setCharacter] = useState(null);

  const onUnauthorized = useCallback(() => { setAuthed(false); setCharacter(null); }, []);
  const api = makeApi(apiBase, onUnauthorized);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await api("/api/auth/me"); if (!cancelled) setAuthed(true); }
      catch { if (!cancelled) setAuthed(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  const logout = useCallback(async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    setAuthed(false); setCharacter(null);
  }, [api]);

  const onLogin = (base) => {
    setApiBase(base);
    localStorage.setItem("cp:apiBase", base);
    setAuthed(true);
  };

  if (authed === null) return <Shell center><div style={{ color: S.inkSoft, fontFamily: serif, fontStyle: "italic", fontSize: 15 }}>正在翻开…</div></Shell>;
  if (!authed) return <AuthScreen defaultBase={apiBase} onLogin={onLogin} />;
  if (!character) return <CharacterList api={api} onEnter={setCharacter} onLogout={logout} />;
  return <Workspace api={api} character={character} onBack={() => setCharacter(null)} onLogout={logout} />;
}

/* ============================================================ 登录/注册 */
function AuthScreen({ defaultBase, onLogin }) {
  const [mode, setMode] = useState("login");
  const [base, setBase] = useState(defaultBase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const api = makeApi(base.replace(/\/$/, ""), null);
      await api(`/api/auth/${mode}`, { method: "POST", body: { email, password } });
      onLogin(base.replace(/\/$/, ""));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Shell center>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 15, fontWeight: 500, color: S.clay, marginBottom: 28, display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, ${S.dust}, ${S.clay})` }} />
          Companion
        </div>
        <div style={{ fontFamily: serif, fontSize: 30, fontWeight: 400, letterSpacing: "-.3px", marginBottom: 10 }}>
          {mode === "login" ? "再见面吧" : "开始记录"}
        </div>
        <div style={{ fontSize: 13.5, color: S.inkSoft, lineHeight: 1.75, marginBottom: 30, maxWidth: 320 }}>
          用真实的对话与记录，重建一个人的说话方式。你的数据加密存放，只有你自己能看见。
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={label}>邮箱</div>
            <input style={inp()} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
          </div>
          <div>
            <div style={label}>密码{mode === "register" ? "（至少 8 位）" : ""}</div>
            <input style={inp()} value={password} onChange={(e) => setPassword(e.target.value)} type="password"
              onKeyDown={(e) => e.key === "Enter" && submit()} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </div>
          {err && <div style={{ color: S.rose, fontSize: 12.5 }}>{err}</div>}
          <Btn onClick={submit} disabled={busy || !email || !password} style={{ padding: 13 }}>
            {busy ? "…" : mode === "login" ? "进入" : "创建并进入"}
          </Btn>
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }} style={linkBtn}>
            {mode === "login" ? "还没有账号？创建一个 →" : "已有账号？回来登录 →"}
          </button>
          <div onClick={() => setShowAdvanced(!showAdvanced)} style={{ fontSize: 12, color: S.inkFaint, cursor: "pointer", textAlign: "center", padding: 6, userSelect: "none" }}>
            ▾ 高级设置
          </div>
          {showAdvanced && (
            <div>
              <div style={label}>后端地址 <span style={{ color: S.inkFaint, fontWeight: 400 }}>（自建服务器才需要填，一般人忽略）</span></div>
              <input style={inp()} value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://your-backend.up.railway.app" />
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

/* ============================================================ 角色列表 */
function CharacterList({ api, onEnter, onLogout }) {
  const [list, setList] = useState(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("中文");
  const [customLang, setCustomLang] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api("/api/characters").then(setList).catch((e) => setErr(e.message)); }, []);
  useEffect(load, []);

  const create = async () => {
    const lang = language === "__custom" ? customLang.trim() : language;
    if (!name.trim() || !lang) return;
    setBusy(true); setErr("");
    try {
      const c = await api("/api/characters", { method: "POST", body: { name: name.trim(), language: lang } });
      onEnter(c);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!confirm("删除这个角色？其全部档案与对话将一并删除，不可恢复。")) return;
    await api(`/api/characters/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <Shell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 32px", flexShrink: 0 }}>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 17, color: S.clay, display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, ${S.dust}, ${S.clay})` }} />
          Companion
        </div>
        <Btn ghost small onClick={onLogout}>退出</Btn>
      </div>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "8px 32px 32px", width: "100%", overflowY: "auto", flex: 1 }}>
        <div style={{ fontFamily: serif, fontSize: 34, fontWeight: 400, letterSpacing: "-.5px", margin: "20px 0 6px" }}>你的角色</div>
        <div style={{ fontSize: 13.5, color: S.inkSoft, marginBottom: 32 }}>每一个都由你喂进去的数据养成。</div>

        <div style={{ background: S.card, border: `1px solid ${S.line}`, borderRadius: 14, padding: 22, marginBottom: 34, boxShadow: S.shadow }}>
          <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 500, marginBottom: 16 }}>创建新角色</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
            <input style={inp({ flex: 2, minWidth: 150 })} value={name} onChange={(e) => setName(e.target.value)} placeholder="名字，比如「他」或某个人的名字" />
            <select style={inp({ flex: 1, minWidth: 130, cursor: "pointer" })} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              <option value="__custom">其他语言…</option>
            </select>
            {language === "__custom" && (
              <input style={inp({ flex: 1, minWidth: 130 })} value={customLang} onChange={(e) => setCustomLang(e.target.value)} placeholder="输入任意语言" />
            )}
            <Btn onClick={create} disabled={busy || !name.trim()}>创建</Btn>
          </div>
          <div style={{ fontSize: 12.5, color: S.inkSoft, marginTop: 12, lineHeight: 1.7 }}>
            语言 = 角色回复用的语言，之后随时能改。人设不用写——进去以后用数据喂出来。
          </div>
        </div>

        {err && <div style={{ color: S.rose, fontSize: 12.5, marginBottom: 12 }}>{err}</div>}
        {list === null ? (
          <div style={{ color: S.inkSoft, fontFamily: serif, fontStyle: "italic", fontSize: 15 }}>翻找中…</div>
        ) : list.length === 0 ? (
          <div style={{ color: S.inkSoft, fontFamily: serif, fontStyle: "italic", fontSize: 15, textAlign: "center", padding: 50 }}>还没有角色，创建第一个吧</div>
        ) : (
          <>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 14, color: S.inkFaint, marginBottom: 16 }}>最近</div>
            {list.map((c) => (
              <div key={c.id} onClick={() => onEnter(c)} style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 20px", marginBottom: 12, background: S.card, border: `1px solid ${S.line}`, borderRadius: 14, cursor: "pointer", boxShadow: S.shadow, transition: "all .16s" }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.borderColor = S.clayLine; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = S.line; }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: serif, fontSize: 18, color: "#FBF8F2", fontWeight: 500, background: avatarGradient(c.name) }}>
                  {c.name.slice(0, 1)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: serif, fontSize: 17, fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: S.inkSoft, marginTop: 3 }}>{c.language} · {c.msg_count} 条对话 · {fmtDate(c.created_at)}创建</div>
                </div>
                <Btn danger small onClick={(e) => remove(c.id, e)}>删除</Btn>
              </div>
            ))}
          </>
        )}
      </div>
    </Shell>
  );
}

/* ============================================================ 工作台 */
function Workspace({ api, character, onBack, onLogout }) {
  const [detail, setDetail] = useState(character);
  const [archives, setArchives] = useState([]);
  const [messages, setMessages] = useState([]);
  const [tab, setTab] = useState("data");
  const [input, setInput] = useState("");
  const [textFeed, setTextFeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [feeding, setFeeding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");
  const [langBar, setLangBar] = useState(false);
  const chatEndRef = useRef(null);
  const fileRef = useRef(null);
  const cid = character.id;

  const refreshDetail = useCallback(() => api(`/api/characters/${cid}`).then(setDetail).catch(() => {}), [cid]);
  const refreshArchives = useCallback(() => api(`/api/characters/${cid}/archives`).then(setArchives).catch(() => {}), [cid]);

  useEffect(() => {
    refreshDetail(); refreshArchives();
    api(`/api/characters/${cid}/chat/history?limit=100`).then(setMessages).catch(() => {});
  }, [cid]);

  // 档案后台异步处理：有 processing 时每 3 秒轮询
  const hasProcessing = archives.some((a) => a.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(async () => { await refreshArchives(); await refreshDetail(); }, 3000);
    return () => clearInterval(timer);
  }, [hasProcessing, refreshArchives, refreshDetail]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const model = detail.persona_model || { facts: [], style: [], phrases: [], patterns: [] };
  const memory = detail.memory || { facts: [], patterns: [], emotions: "", threads: [] };
  const featCount = model.facts.length + model.style.length + model.phrases.length + model.patterns.length;

  /* ---------- 喂数据 ---------- */
  const feedText = async () => {
    const t = textFeed.trim();
    if (!t) return;
    setTextFeed(""); setFeeding(true); setErr("");
    try { await api(`/api/characters/${cid}/archives`, { method: "POST", body: { kind: "text", label: t.slice(0, 22), content: t } }); }
    catch (e) { setErr(e.message); }
    await refreshArchives(); await refreshDetail(); setFeeding(false);
  };

  const feedFiles = async (files) => {
    setFeeding(true); setErr("");
    for (const file of files) {
      try {
        if (file.type.startsWith("image/")) {
          const data = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result.split(",")[1]);
            r.onerror = rej; r.readAsDataURL(file);
          });
          await api(`/api/characters/${cid}/archives`, { method: "POST", body: { kind: "image", label: file.name, content: data, mediaType: file.type } });
        } else if (file.type.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(file.name)) {
          const text = (await file.text()).slice(0, 30000);
          await api(`/api/characters/${cid}/archives`, { method: "POST", body: { kind: "text", label: file.name, content: text } });
        } else {
          await api(`/api/characters/${cid}/archives`, { method: "POST", body: { kind: "av", label: file.name, content: "" } });
        }
      } catch (e) { setErr(e.message); }
    }
    await refreshArchives(); await refreshDetail(); setFeeding(false);
  };

  /* ---------- 档案编辑 ---------- */
  const openArchive = async (a) => {
    try { const full = await api(`/api/characters/${cid}/archives/${a.id}`); setEditing(full); }
    catch (e) { setErr(e.message); }
  };
  const saveEdit = async () => {
    setFeeding(true);
    try { await api(`/api/characters/${cid}/archives/${editing.id}`, { method: "PUT", body: { label: editing.label, content: editing.content } }); setEditing(null); }
    catch (e) { setErr(e.message); }
    await refreshArchives(); await refreshDetail(); setFeeding(false);
  };
  const deleteArchive = async () => {
    if (!confirm("删除这条档案？模型将自动更新。")) return;
    setFeeding(true);
    try { await api(`/api/characters/${cid}/archives/${editing.id}`, { method: "DELETE" }); setEditing(null); }
    catch (e) { setErr(e.message); }
    await refreshArchives(); await refreshDetail(); setFeeding(false);
  };
  const rebuild = async () => {
    if (!confirm(`深度重建会对全部 ${archives.length} 个档案重新提取特征（消耗 API 调用），一般只在提取效果不满意时用。继续？`)) return;
    setFeeding(true);
    try { await api(`/api/characters/${cid}/archives/rebuild`, { method: "POST" }); } catch (e) { setErr(e.message); }
    await refreshArchives(); await refreshDetail(); setFeeding(false);
  };

  const exportChar = async () => {
    const full = confirm("同时导出文本档案的解密原文？\n\n确定 = 完整导出（含原文）\n取消 = 仅导出人设模型 + 对话记忆 + 档案清单");
    try {
      const data = await api(`/api/characters/${cid}/export${full ? "?full=1" : ""}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `companion-${(detail.name || "character").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40)}-export.json`;
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setErr(e.message); }
  };

  /* ---------- 对话 ---------- */
  const send = async () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput(""); setErr("");
    setMessages((m) => [...m, { role: "user", content: t, id: `tmp${Date.now()}` }]);
    setBusy(true);
    try {
      const { reply } = await api(`/api/characters/${cid}/chat`, { method: "POST", body: { message: t } });
      setMessages((m) => [...m, { role: "assistant", content: reply, id: `tmp${Date.now()}r` }]);
      refreshDetail();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const clearChat = async () => {
    if (!confirm("清空全部对话与对话记忆？人设与档案保留。")) return;
    await api(`/api/characters/${cid}/chat/history`, { method: "DELETE" });
    setMessages([]); refreshDetail();
  };

  const changeLang = async (lang) => {
    await api(`/api/characters/${cid}`, { method: "PATCH", body: { language: lang } });
    setLangBar(false); refreshDetail();
  };

  const arcIcon = { image: "▦", text: "✎", av: "▶" };
  const arcStatusStyle = { done: { color: S.sage }, processing: { color: S.dust, fontStyle: "italic" }, error: { color: S.rose }, pending_transcript: { color: S.mist } };
  const arcStatusText = { done: "已提取", processing: "提取中…", error: "失败", pending_transcript: "待转写" };

  return (
    <Shell>
      {/* 顶栏 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 28px", borderBottom: `1px solid ${S.line}`, flexShrink: 0, background: S.paper }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: S.inkSoft, fontSize: 18, cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>←</button>
          <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: serif, fontSize: 17, color: "#FBF8F2", fontWeight: 500, background: avatarGradient(detail.name) }}>
            {detail.name.slice(0, 1)}
          </div>
          <div>
            <div style={{ fontFamily: serif, fontSize: 21, fontWeight: 500, lineHeight: 1.2 }}>{detail.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 3 }}>
              <button onClick={() => setLangBar(!langBar)} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: S.claySoft, border: `1px solid ${S.clayLine}`, color: S.clay, fontFamily: sans, fontSize: 11.5, fontWeight: 500, cursor: "pointer", padding: "3px 10px", borderRadius: 20 }}>
                🌐 {detail.language} <span style={{ opacity: .6 }}>▾</span>
              </button>
              <span style={{ fontSize: 12, color: S.inkSoft }}>{archives.length} 份档案 · {featCount} 条特征{feeding ? " · 处理中…" : ""}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn ghost small onClick={exportChar}>导出</Btn>
          <Btn ghost small onClick={rebuild} disabled={feeding || !archives.length}>重建</Btn>
          <Btn ghost small onClick={onLogout}>退出</Btn>
        </div>
      </div>

      {/* 语言选择栏 */}
      {langBar && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "14px 28px", borderBottom: `1px solid ${S.line}`, background: S.card, flexShrink: 0 }}>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: S.inkSoft, width: "100%", marginBottom: 2 }}>角色回复用哪种语言？随时可切换</div>
          {LANGUAGES.map((l) => (
            <button key={l} onClick={() => changeLang(l)} style={{
              background: l === detail.language ? S.clay : S.paper, color: l === detail.language ? "#FBF8F2" : S.ink,
              border: `1px solid ${l === detail.language ? S.clay : S.line}`, borderRadius: 20, padding: "6px 14px", fontSize: 12.5, fontFamily: sans, cursor: "pointer",
            }}>{l}</button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* 左栏 */}
        <div style={{ width: 372, borderRight: `1px solid ${S.line}`, display: "flex", flexDirection: "column", background: S.paper, flexShrink: 0 }}>
          <div style={{ display: "flex", padding: "0 20px", gap: 4, borderBottom: `1px solid ${S.line}`, flexShrink: 0 }}>
            {[["data", "数据档案"], ["model", "人设模型"], ["memory", "对话记忆"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                padding: "14px 8px 12px", fontSize: 13, fontFamily: sans, fontWeight: 500, cursor: "pointer",
                background: "none", border: "none", color: tab === k ? S.clay : S.inkFaint,
                borderBottom: tab === k ? `2px solid ${S.clay}` : "2px solid transparent", position: "relative", top: 1,
              }}>{lbl}</button>
            ))}
          </div>

          {tab === "data" && (
            <div style={pane}>
              <div style={note}>只喂<b style={{ color: S.clay, fontWeight: 600 }}>客观数据</b>（聊天记录、截图、真实记录），别写主观印象。每条自动加密存档，随时可改可删，模型会自己更新。</div>
              <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); feedFiles([...e.dataTransfer.files]); }}
                style={{ border: `1.5px dashed ${S.clayLine}`, borderRadius: 12, padding: "26px 16px", textAlign: "center", cursor: "pointer", background: S.card }}>
                <div style={{ fontFamily: serif, fontSize: 16, color: S.clay, fontWeight: 500, marginBottom: 5 }}>拖进来，或点击上传</div>
                <div style={{ fontSize: 12, color: S.inkSoft }}>截图 · txt 聊天记录 · 图片 · 语音 · 视频</div>
                <input ref={fileRef} type="file" multiple hidden accept="image/*,text/*,.txt,.md,.csv,.json,audio/*,video/*"
                  onChange={(e) => { feedFiles([...e.target.files]); e.target.value = ""; }} />
              </div>
              <div>
                <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 500, marginBottom: 10 }}>或者，粘贴一段文字</div>
                <textarea value={textFeed} onChange={(e) => setTextFeed(e.target.value)}
                  placeholder={"[6 月 12 日]\n他：诶 到家了吗\n我：刚到\n他：那就好 早点睡"}
                  style={inp({ minHeight: 110, width: "100%", resize: "vertical", fontSize: 13, lineHeight: 1.7 })} />
                <Btn onClick={feedText} disabled={!textFeed.trim() || feeding} style={{ width: "100%", marginTop: 10 }}>
                  {feeding ? "处理中…" : "存档并提取"}
                </Btn>
              </div>
              {archives.length > 0 && (
                <div>
                  <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 14, color: S.inkSoft, marginBottom: 10 }}>已有 {archives.length} 份</div>
                  {archives.map((a) => (
                    <div key={a.id} onClick={() => openArchive(a)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", marginBottom: 8, background: S.card, border: `1px solid ${S.line}`, borderRadius: 10, fontSize: 13, cursor: "pointer" }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, background: S.paper2, color: S.mist }}>{arcIcon[a.kind] || "?"}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</div>
                        <div style={{ fontSize: 11, color: S.inkFaint, marginTop: 2 }}>{fmtDateTime(a.created_at)}</div>
                      </div>
                      <div style={{ fontSize: 11.5, flexShrink: 0, ...(arcStatusStyle[a.status] || {}) }}>{arcStatusText[a.status]}</div>
                    </div>
                  ))}
                  {archives.some((a) => a.status === "pending_transcript") && (
                    <div style={{ fontSize: 11.5, color: S.inkSoft, lineHeight: 1.8, marginTop: 4, fontStyle: "italic" }}>
                      语音/视频档案已保存。点开它把内容打成文字保存即可入模型。
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "model" && (
            <div style={pane}>
              <div style={paneIntro}>模型是所有档案特征的聚合。档案一变，模型立刻更新，不额外花 API。</div>
              <MBlock title="原话样本" count={model.phrases.length} items={model.phrases} quote />
              <MBlock title="说话风格" count={model.style.length} items={model.style} clay />
              <MBlock title="客观事实" count={model.facts.length} items={model.facts} />
              <MBlock title="行为模式" count={model.patterns.length} items={model.patterns} />
            </div>
          )}

          {tab === "memory" && (
            <div style={pane}>
              <div style={paneIntro}>这一层跟人设分开：是 TA 对「你」的记忆，每聊几轮自动提炼一次。更细的内容会在对话时按话题实时召回。</div>
              <MBlock title="关于你" items={memory.facts} />
              <MBlock title="你的模式" items={memory.patterns} />
              <MBlock title="此刻的情绪" items={memory.emotions ? [memory.emotions] : []} clay />
              <MBlock title="还没聊完的" items={memory.threads} />
              <Btn ghost onClick={clearChat} style={{ width: "100%", marginTop: 6 }}>清空对话与记忆</Btn>
            </div>
          )}
        </div>

        {/* 对话区 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: S.paper }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
            {messages.length === 0 ? (
              <div style={{ color: S.inkSoft, fontFamily: serif, fontStyle: "italic", fontSize: 15, textAlign: "center", marginTop: 90, lineHeight: 2 }}>
                {featCount === 0 ? <>先在左侧喂数据建模型<br />再开始对话</> : <>模型已有 {featCount} 条特征<br />和 {detail.name} 说点什么吧（回复语言：{detail.language}）</>}
              </div>
            ) : (
              <div style={{ textAlign: "center", fontFamily: serif, fontStyle: "italic", fontSize: 12.5, color: S.inkFaint, margin: "0 0 6px" }}>· 今天 ·</div>
            )}
            {messages.map((m) => (
              <div key={m.id} style={{ maxWidth: "68%", display: "flex", flexDirection: "column", alignSelf: m.role === "user" ? "flex-end" : "flex-start", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  padding: "11px 16px", fontSize: 14, lineHeight: 1.65, borderRadius: 16, whiteSpace: "pre-wrap",
                  ...(m.role === "user"
                    ? { background: S.clay, color: "#FBF8F2", borderBottomRightRadius: 5 }
                    : { background: S.card, border: `1px solid ${S.line}`, borderBottomLeftRadius: 5 }),
                }}>{m.content}</div>
              </div>
            ))}
            {busy && <div style={{ color: S.clay, fontSize: 20, letterSpacing: 2 }}>···</div>}
            <div ref={chatEndRef} />
          </div>
          {err && <div style={{ color: S.rose, fontSize: 12.5, padding: "0 32px 8px" }}>{err}</div>}
          <div style={{ display: "flex", gap: 12, padding: "18px 28px", borderTop: `1px solid ${S.line}`, background: S.paper, alignItems: "center" }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder={featCount === 0 ? "建议先喂数据…" : "说点什么…"}
              style={inp({ flex: 1, padding: "13px 18px", borderRadius: 24, background: S.card })} />
            <button onClick={send} disabled={busy || !input.trim()} style={{
              width: 46, height: 46, borderRadius: "50%", flexShrink: 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
              background: busy || !input.trim() ? S.line : S.clay, color: "#FBF8F2", border: "none", cursor: busy || !input.trim() ? "default" : "pointer",
            }}>↑</button>
          </div>
        </div>
      </div>

      {/* 档案编辑弹层 */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(51,48,42,.35)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div style={{ background: S.paper, border: `1px solid ${S.line}`, borderRadius: 18, width: "100%", maxWidth: 540, maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 26, gap: 16, boxShadow: "0 24px 60px rgba(51,48,42,.22)" }}>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: S.clay, display: "flex", alignItems: "center", gap: 8 }}>
              {{ image: "图片档案", text: "文字档案", av: "语音/视频档案" }[editing.kind]} <span style={{ fontSize: 11, color: S.inkFaint, fontStyle: "normal" }}>🔒 加密存储</span>
            </div>
            <input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} style={inp({ fontFamily: serif, fontSize: 16, fontWeight: 500 })} />
            {editing.kind === "image" ? (
              <img src={`data:${editing.mediaType};base64,${editing.content}`} alt="" style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", border: `1px solid ${S.line}`, borderRadius: 8 }} />
            ) : (
              <textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                placeholder={editing.kind === "av" ? "把这段语音/视频的内容打成文字填在这里，保存后即入模型" : ""}
                style={inp({ minHeight: 220, resize: "vertical", fontSize: 13, lineHeight: 1.75 })} />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Btn danger onClick={deleteArchive}>删除档案</Btn>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn ghost onClick={() => setEditing(null)}>取消</Btn>
                <Btn onClick={saveEdit} disabled={feeding}>{editing.kind !== "image" ? "保存 · 更新模型" : "保存标题"}</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ============================================================ 基础组件 */
function Shell({ children, center }) {
  return (
    <div style={{
      minHeight: "100vh", height: "100vh", background: S.paper, color: S.ink, fontFamily: sans, fontSize: 14, lineHeight: 1.6,
      display: "flex", flexDirection: "column", WebkitFontSmoothing: "antialiased", position: "relative",
      ...(center ? { alignItems: "center", justifyContent: "center", padding: 24 } : {}),
    }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; }
        ::selection { background: ${S.claySoft}; }
        body { margin: 0; background: ${S.paper}; }
        textarea:focus, input:focus, select:focus { outline: none; border-color: ${S.clayLine} !important; box-shadow: 0 0 0 3px ${S.claySoft}; }
        input::placeholder, textarea::placeholder { color: ${S.inkFaint}; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-thumb { background: ${S.line}; border-radius: 10px; border: 3px solid ${S.paper}; }
        ::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      {/* 纸张颗粒 */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, opacity: .4,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.035'/%3E%3C/svg%3E")` }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, width: "100%", ...(center ? { alignItems: "center", justifyContent: "center" } : {}) }}>
        {children}
      </div>
    </div>
  );
}

const label = { fontSize: 12, color: S.inkSoft, marginBottom: 7, fontWeight: 500 };
const linkBtn = { background: "none", border: "none", color: S.inkSoft, fontSize: 13, fontFamily: sans, cursor: "pointer", padding: 4, textAlign: "center" };
const pane = { flex: 1, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 18 };
const paneIntro = { fontSize: 12, color: S.inkSoft, lineHeight: 1.8, fontStyle: "italic", fontFamily: serif };
const note = { fontSize: 12.5, color: S.inkSoft, lineHeight: 1.85, padding: "13px 15px", background: S.claySoft, border: `1px solid ${S.clayLine}`, borderRadius: 10 };

function inp(extra = {}) {
  return { background: S.card, border: `1px solid ${S.line}`, color: S.ink, padding: "11px 14px", fontSize: 14, fontFamily: sans, borderRadius: 8, width: "100%", ...extra };
}

function MBlock({ title, count, items, quote, clay }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontFamily: serif, fontSize: 13, fontWeight: 500, color: S.ink, marginBottom: 10, display: "flex", alignItems: "baseline", gap: 7 }}>
        {title}{count != null && <span style={{ fontSize: 11, color: S.inkFaint, fontFamily: sans, fontWeight: 400 }}>{count} 条</span>}
      </div>
      {(!items || items.length === 0) ? (
        <div style={{ fontSize: 12, color: S.inkFaint, fontStyle: "italic" }}>（等待数据）</div>
      ) : items.map((it, i) => (
        <div key={i} style={{
          fontSize: 12.5, lineHeight: 1.65, padding: "9px 13px", marginBottom: 7,
          background: S.card, border: `1px solid ${S.lineSoft}`, borderRadius: 10,
          borderLeft: `2.5px solid ${quote ? S.rose : clay ? S.clay : S.dust}`,
          ...(quote ? { fontStyle: "italic", fontFamily: serif, color: S.ink } : {}),
        }}>{it}</div>
      ))}
    </div>
  );
}

function Btn({ children, onClick, disabled, ghost, danger, small, style }) {
  const base = {
    fontFamily: sans, fontSize: small ? 12 : 13, fontWeight: 500,
    padding: small ? "6px 12px" : "9px 18px", borderRadius: 8, cursor: disabled ? "default" : "pointer", whiteSpace: "nowrap", transition: "all .16s",
  };
  let colors;
  if (ghost) colors = { background: "transparent", border: `1px solid ${S.line}`, color: S.inkSoft };
  else if (danger) colors = { background: "transparent", border: "1px solid transparent", color: S.rose };
  else colors = { background: disabled ? S.line : S.clay, border: `1px solid ${disabled ? S.line : S.clay}`, color: "#FBF8F2" };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...colors, ...style }}>{children}</button>;
}
