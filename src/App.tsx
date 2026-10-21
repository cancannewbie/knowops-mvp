import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import type { User } from "../shared/contracts";
import { api, post } from "./api";

import { Alert, Empty } from "./components/ui";
import { Chat } from "./pages/Chat";
import { Debug } from "./pages/Debug";
import { Evaluation } from "./pages/Evaluation";
import { Feedback } from "./pages/Feedback";
import { Jobs } from "./pages/Jobs";
import { Knowledge } from "./pages/Knowledge";
import { Overview } from "./pages/Overview";
const navigation = [
  ["overview", "◈", "工作概览"],
  ["knowledge", "▧", "知识资料"],
  ["jobs", "↻", "处理任务"],
  ["chat", "✦", "问答工作台"],
  ["debug", "⌕", "检索诊断"],
  ["evaluation", "▥", "质量评测"],
  ["feedback", "◎", "反馈案例"],
];
const time = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("admin@example.test");
  const [password, setPassword] = useState("DemoPass123!");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/login", { email, password });
      onLogin();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <div className="login-story">
        <div className="brand">
          K<span>KnowOps</span>
        </div>
        <p className="eyebrow">KNOWLEDGE → EVIDENCE → QUALITY</p>
        <h1>
          让每一次回答
          <br />
          都有据可循。
        </h1>
        <p>
          从资料发布到引用问答，从错误反馈到逐题评测。
          <br />
          一个可追溯的 AI 知识运营工作台。
        </p>
        <div className="login-diagram">
          <span>01 知识入库</span>
          <i>→</i>
          <span>02 证据问答</span>
          <i>→</i>
          <span>03 质量回归</span>
        </div>
        <small>虚构资料 · 真实数据链路 · 演示账户仅供本地使用</small>
      </div>
      <form onSubmit={submit} className="login-form">
        <p className="eyebrow">WELCOME BACK</p>
        <h2>进入演示空间</h2>
        <p className="muted">选择身份，体验不同的资料访问范围。</p>
        <div className="segmented">
          <button
            type="button"
            className={email.startsWith("admin") ? "selected" : ""}
            onClick={() => setEmail("admin@example.test")}
          >
            知识运营者
          </button>
          <button
            type="button"
            className={email.startsWith("member") ? "selected" : ""}
            onClick={() => setEmail("member@example.test")}
          >
            支持专员
          </button>
        </div>
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <Alert>{error}</Alert>
        <button className="primary wide" disabled={busy}>
          {busy ? "正在登录…" : "登录工作台 →"}
        </button>
        <small>
          演示密码：DemoPass123!
          <br />
          支持专员无法查看运维受限资料。
        </small>
      </form>
    </div>
  );
}

export function App() {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{
        user: User;
        provider: string;
        embedding: string;
        releaseId: string;
      }>("/me"),
  });
  const [page, setPage] = useState(location.hash.slice(1) || "overview");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const h = () => setPage(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  if (me.isPending) return <Empty>正在连接知识工作台…</Empty>;
  if (!me.data)
    return (
      <Login
        onLogin={() => {
          client.clear();
          void me.refetch();
        }}
      />
    );
  const user = me.data.user;
  const go = (p: string) => {
    location.hash = p;
    setPage(p);
  };
  const restricted =
    ["jobs", "debug", "evaluation", "feedback"].includes(page) &&
    user.role !== "admin";
  const refresh = () => {
    void client.invalidateQueries();
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          K
          <span>
            KnowOps<small>知识 · 问答 · 质量</small>
          </span>
        </div>
        <div className="workspace">
          <span>DEMO SPACE</span>
          <strong>产品支持知识空间</strong>
          <small>共享资料 + 运维资料</small>
        </div>
        <nav>
          {navigation
            .filter(
              ([p]) =>
                user.role === "admin" ||
                !["jobs", "debug", "evaluation", "feedback"].includes(p),
            )
            .map(([key, icon, title]) => (
              <button
                className={page === key ? "active" : ""}
                key={key}
                onClick={() => go(key)}
              >
                <span>{icon}</span>
                {title}
                {page === key && <i />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{user.role === "admin" ? "运" : "支"}</span>
          <div>
            <strong>{user.name}</strong>
            <small>
              {user.role === "admin" ? "管理与运维权限" : "团队共享资料"}
            </small>
          </div>
          <button
            aria-label="退出登录"
            title="退出登录"
            onClick={() => {
              void post("/logout").then(() => {
                client.clear();
                void me.refetch();
              });
            }}
          >
            ↪
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            产品支持 /{" "}
            <b>{navigation.find((n) => n[0] === page)?.[2] ?? "工作概览"}</b>
          </span>
          <div>
            <span className="mode">
              ●{" "}
              {me.data.provider === "extractive-demo"
                ? "确定性摘录演示"
                : "真实模型适配"}
            </span>
            <span className="subtle">本地 MVP</span>
          </div>
        </header>
        <div className="content">
          <Alert>{notice}</Alert>
          {restricted ? (
            <Empty>当前身份无权访问此页面。</Empty>
          ) : page === "overview" ? (
            <Overview
              go={go}
              mode={me.data.provider}
              embedding={me.data.embedding}
            />
          ) : page === "knowledge" ? (
            <Knowledge user={user} notify={setNotice} refresh={refresh} />
          ) : page === "jobs" ? (
            <Jobs notify={setNotice} refresh={refresh} />
          ) : page === "chat" ? (
            <Chat user={user} notify={setNotice} />
          ) : page === "debug" ? (
            <Debug />
          ) : page === "evaluation" ? (
            <Evaluation notify={setNotice} refresh={refresh} />
          ) : page === "feedback" ? (
            <Feedback go={go} notify={setNotice} refresh={refresh} />
          ) : (
            <Empty>页面不存在</Empty>
          )}
        </div>
      </main>
    </div>
  );
}
