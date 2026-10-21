import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Run, Source, User } from "../../shared/contracts";
import { terminal } from "../../shared/contracts";
import { api, post } from "../api";
import { useRunStream } from "../stream";

import { Alert, Badge, Heading, Modal, time } from "../components/ui";
export function Chat({
  user,
  notify,
}: {
  user: User;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Run[]>("/runs"),
    refetchInterval: 4000,
  });
  const [conversation, setConversation] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [active, setActive] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [version, setVersion] = useState("V2");
  const [config, setConfig] = useState("B");
  const [sending, setSending] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [feedback, setFeedback] = useState<{
    id: string;
    useful: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [follow, setFollow] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const onDone = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["runs"] });
  }, [client]);
  const stream = useRunStream(active, onDone);
  const current = stream.run?.id === active ? stream.run : null;
  const stored = (runs.data ?? [])
    .filter((r) => r.conversation_id === conversation)
    .reverse();
  const messages =
    current && current.conversation_id === conversation
      ? stored.some((r) => r.id === current.id)
        ? stored.map((r) => (r.id === current.id ? current : r))
        : [...stored, current]
      : stored;
  useEffect(() => {
    if (follow && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [current?.answer, messages.length, follow]);
  async function send(e?: FormEvent, override?: string) {
    e?.preventDefault();
    const q = override ?? question;
    if (!q.trim()) return;
    setSending(true);
    try {
      const r = await post<Run>("/runs", {
        question: q,
        version,
        config,
        conversationId: conversation,
        idempotencyKey: crypto.randomUUID(),
      });
      setActive(r.id);
      setQuestion("");
      setFollow(true);
      await client.invalidateQueries({ queryKey: ["runs"] });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const conversations = [
    ...new Map((runs.data ?? []).map((r) => [r.conversation_id, r])).values(),
  ];
  return (
    <>
      <Heading
        eyebrow="EVIDENCE-BASED ANSWERS"
        title="问答工作台"
        description="先选择产品版本，再核对答案来源。当前回答会绑定创建时的知识发布。"
      />
      <div className="chat-layout">
        <aside className="conversation-list">
          <button
            className="primary wide"
            onClick={() => {
              setConversation(crypto.randomUUID());
              setActive(null);
            }}
          >
            ＋ 新建会话
          </button>
          <small className="muted">最近会话</small>
          {conversations.map((r) => (
            <button
              key={r.conversation_id}
              className={r.conversation_id === conversation ? "selected" : ""}
              onClick={() => {
                setConversation(r.conversation_id);
                const latest = runs.data?.find(
                  (x) => x.conversation_id === r.conversation_id,
                );
                setActive(latest?.id ?? null);
                setVersion(r.product_version);
                setFollow(true);
              }}
            >
              {r.question}
              <small>{time(r.created_at)}</small>
            </button>
          ))}
        </aside>
        <section className="chat-card">
          <div className="chat-toolbar">
            <label>
              产品
              <select
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              >
                {["V1", "V2", "V3"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              检索
              <select
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              >
                <option value="A">A · 向量 Top 1</option>
                <option value="B">B · 混合 Top 3</option>
              </select>
            </label>
            <span className="muted">
              {current ? stream.connection : "新会话"}
            </span>
          </div>
          <div
            className="messages"
            ref={scroll}
            onScroll={() => {
              const el = scroll.current;
              if (el)
                setFollow(
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80,
                );
            }}
          >
            {!messages.length && (
              <div className="chat-empty">
                <span className="ai-mark">✦</span>
                <h2>从一个具体问题开始</h2>
                <p>回答将附带可核对的资料修订和原文片段。</p>
                {[
                  "V2 成员导入限制是多少？",
                  "IMPORT_EMAIL_DUPLICATE 怎么处理？",
                  "客户部署有什么特殊配置？",
                ].map((q) => (
                  <button key={q} onClick={() => setQuestion(q)}>
                    {q} ↗
                  </button>
                ))}
              </div>
            )}
            {messages.map((r) => (
              <article className="exchange" key={r.id}>
                <div className="question">
                  <span>你</span>
                  <p>{r.question}</p>
                </div>
                <div className="answer">
                  <span className="ai-mark">✦</span>
                  <div className="answer-body">
                    <div className="answer-meta">
                      <strong>KnowOps</strong>
                      <Badge status={r.status} />
                      <small>
                        {r.provider === "extractive-demo"
                          ? "原文摘录演示"
                          : "真实模型"}{" "}
                        · {r.product_version} · {r.config}
                      </small>
                    </div>
                    {r.answer ? (
                      <div className="markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {r.answer}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="muted">正在查找授权资料…</p>
                    )}
                    {r.error && <Alert>{r.error}</Alert>}
                    <div className="sources">
                      {r.refs.map((s) => (
                        <button
                          key={s.id}
                          onClick={() =>
                            void api<Source>(`/runs/${r.id}/sources/${s.id}`)
                              .then(setSource)
                              .catch((e) => notify(e.message))
                          }
                        >
                          <b>{s.id}</b>
                          {s.title}
                          <small>r{s.revision}</small>
                        </button>
                      ))}
                    </div>
                    {terminal(r.status) && (
                      <div className="answer-actions">
                        <button
                          onClick={() => {
                            setFeedback({ id: r.id, useful: true });
                            setReason("");
                          }}
                        >
                          有帮助
                        </button>
                        <button
                          onClick={() => {
                            setFeedback({ id: r.id, useful: false });
                            setReason("");
                          }}
                        >
                          反馈问题
                        </button>
                        <button
                          onClick={() => void send(undefined, r.question)}
                          disabled={sending}
                        >
                          重新生成
                        </button>
                        {user.role === "admin" && (
                          <a href="#debug">查看检索诊断 →</a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!follow && (
            <button
              className="scroll-bottom"
              onClick={() => {
                setFollow(true);
                if (scroll.current)
                  scroll.current.scrollTop = scroll.current.scrollHeight;
              }}
            >
              回到底部 ↓
            </button>
          )}
          <form className="composer" onSubmit={send}>
            <textarea
              aria-label="输入问题"
              placeholder="输入问题，例如：V2 一次可以导入多少成员？"
              value={question}
              maxLength={5000}
              onChange={(e) => setQuestion(e.target.value)}
              required
            />
            <div>
              <small>引用映射已校验 · 内容支持度需人工复核</small>
              {current && !terminal(current.status) ? (
                <button
                  type="button"
                  onClick={() =>
                    void post(`/runs/${current.id}/cancel`)
                      .then(() => {
                        onDone();
                        stream.retry();
                      })
                      .catch((e) => notify(e.message))
                  }
                >
                  ■ 停止生成
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={sending || !question.trim()}
                >
                  {sending ? "提交中…" : "发送问题 ↑"}
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
      {source && (
        <Modal
          title={`引用 ${source.id} · ${source.title}`}
          onClose={() => setSource(null)}
        >
          <p className="muted">
            资料修订 {source.revision} ·{" "}
            {source.page ? `第 ${source.page} 页` : `第 ${source.paragraph} 段`}
          </p>
          <pre className="source-text">{source.text}</pre>
          <p className="callout">
            来源已匹配。此标识不代表原文已被人工确认能够支持所有答案结论。
          </p>
          <a
            className="button"
            href={`/api/documents/${source.documentId}/file${source.page ? `#page=${source.page}` : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            打开原始资料 ↗
          </a>
        </Modal>
      )}
      {feedback && (
        <Modal
          title={feedback.useful ? "标记回答有帮助" : "反馈错误案例"}
          onClose={() => setFeedback(null)}
        >
          <label>
            说明
            <textarea
              placeholder="例如：遗漏管理员角色限制 / 引用了旧版本…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
            />
          </label>
          <button
            className="primary wide"
            onClick={() =>
              void post(`/runs/${feedback.id}/feedback`, {
                useful: feedback.useful,
                reason,
              })
                .then(() => {
                  setFeedback(null);
                  notify("反馈已保存，可在反馈案例中追踪。");
                })
                .catch((e) => notify(e.message))
            }
          >
            保存反馈
          </button>
        </Modal>
      )}
    </>
  );
}
