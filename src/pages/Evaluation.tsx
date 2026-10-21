import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { statuses } from "../../shared/contracts";
import { api, post } from "../api";

import { Alert, Badge, Empty, Heading, Modal, time } from "../components/ui";
export function Evaluation({
  notify,
  refresh,
}: {
  notify: (s: string) => void;
  refresh: () => void;
}) {
  const datasets = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api<any[]>("/datasets"),
  });
  const jobs = useQuery({
    queryKey: ["evaluations"],
    queryFn: () => api<any[]>("/evaluations"),
    refetchInterval: 1300,
  });
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [view, setView] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [review, setReview] = useState("");
  const [creating, setCreating] = useState(false);
  const dataset =
    datasets.data?.find((d) => d.id === selected) ?? datasets.data?.[0];
  const job = creating
    ? undefined
    : view
      ? jobs.data?.find((j) => j.id === view)
      : jobs.data?.[0];
  async function run() {
    setCreating(true);
    try {
      const r = await post("/evaluations", { datasetId: dataset.id });
      setView(r.id);
      refresh();
      notify("A/B 评测已排队，逐题结果将陆续保存。");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  const summary = (config: string) => {
    const rows = job?.results.filter((r: any) => r.config === config) ?? [];
    return {
      done: rows.filter((r: any) => r.status === "completed").length,
      failed: rows.filter((r: any) => r.status === "failed").length,
      cancelled: rows.filter((r: any) => r.status === "cancelled").length,
      passed: rows.filter((r: any) => r.passed).length,
      total: (job?.planned ?? 0) / 2,
      rows,
    };
  };
  return (
    <>
      <Heading
        eyebrow="QUALITY LAB"
        title="用同一套题，比较两种方案"
        description="A：向量排序 Top 1；B：关键词与向量混合 Top 3。结果显示规则命中，保留人工复核。"
      />
      <div className="card">
        <div className="evaluation-controls">
          <label>
            版本化测试集
            <select
              value={dataset?.id ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {datasets.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · v{d.version} · {d.cases.length} 题
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              setName(dataset?.name ?? "产品支持回归集");
              setDraft(JSON.stringify(dataset?.cases ?? [], null, 2));
              setEditing(true);
            }}
          >
            编辑为新版本
          </button>
          <button
            className="primary"
            disabled={!dataset || creating}
            onClick={() => void run()}
          >
            运行 A/B 评测 ↗
          </button>
        </div>
        <details>
          <summary>查看测试题与预期（含权限、版本及缺资料样本）</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>问题</th>
                  <th>身份/版本</th>
                  <th>预期</th>
                </tr>
              </thead>
              <tbody>
                {dataset?.cases.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.question}</td>
                    <td>
                      {c.as} / {c.version}
                    </td>
                    <td>{c.refuse ? "应拒答" : c.expected.join("、")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div className="card">
        <div className="section-title">
          <h3>评测运行记录</h3>
          <select
            aria-label="选择评测记录"
            value={job?.id ?? ""}
            onChange={(e) => setView(e.target.value)}
          >
            {jobs.data?.map((j) => (
              <option key={j.id} value={j.id}>
                {time(j.created_at)} · {statuses[j.status]}
              </option>
            ))}
          </select>
        </div>
        {job ? (
          <>
            <div className="facts">
              <Badge status={job.status} />
              <span>
                {job.provider === "extractive-demo"
                  ? "摘录演示评测"
                  : "真实模型评测"}
              </span>
              <span>
                完成记录 {job.results.length} / {job.planned}
              </span>
              {["queued", "running"].includes(job.status) && (
                <button
                  onClick={() =>
                    void post(`/evaluations/${job.id}/cancel`)
                      .then(refresh)
                      .catch((e) => notify(e.message))
                  }
                >
                  取消评测
                </button>
              )}
            </div>
            <Alert>{job.error}</Alert>
            <div className="two-cols">
              {["A", "B"].map((c) => {
                const s = summary(c);
                return (
                  <div className="metric-card" key={c}>
                    <span>配置 {c}</span>
                    <strong>
                      {s.passed}
                      <small> / {s.total} 题规则命中</small>
                    </strong>
                    <p>
                      运行完成 {s.done} · 失败 {s.failed} · 取消 {s.cancelled} ·
                      待运行 {Math.max(0, s.total - s.rows.length)}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="callout">
              规则只检查预期关键词与拒答行为，不代表语义正确率。失败和取消均保留在计划样本分母中。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>测试题</th>
                    <th>配置 A</th>
                    <th>配置 B</th>
                    <th>变化</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...new Map(
                      job.results.map((r: any) => [r.caseId, r]),
                    ).values(),
                  ].map((item: any) => {
                    const a = job.results.find(
                      (r: any) => r.caseId === item.caseId && r.config === "A",
                    );
                    const b = job.results.find(
                      (r: any) => r.caseId === item.caseId && r.config === "B",
                    );
                    return (
                      <tr key={item.caseId}>
                        <td>
                          <strong>{item.question}</strong>
                          <small>
                            {item.as} · {item.version}
                          </small>
                        </td>
                        {[a, b].map((r, i) => (
                          <td key={i}>
                            {r ? (
                              <button
                                className={
                                  r.passed ? "result-pass" : "result-fail"
                                }
                                onClick={() => {
                                  setDetail({ ...r, jobId: job.id });
                                  setReview(r.review?.note ?? "");
                                }}
                              >
                                {r.status === "failed"
                                  ? "运行失败"
                                  : r.passed
                                    ? "规则命中"
                                    : "待改进"}
                                {r.review ? " · 已复核" : ""} ↗
                              </button>
                            ) : (
                              <span className="muted">等待运行</span>
                            )}
                          </td>
                        ))}
                        <td>
                          {a && b
                            ? a.passed === b.passed
                              ? "持平"
                              : b.passed
                                ? "↑ 改进"
                                : "↓ 退步"
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Empty>还没有评测记录。运行一组 A/B 对照开始检查质量。</Empty>
        )}
      </div>
      {editing && (
        <Modal title="保存测试集新版本" onClose={() => setEditing(false)}>
          <label>
            测试集名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="muted">
            每题包含 id、question、version、as、expected 和
            refuse。旧版本不会被覆盖。
          </p>
          <label>
            测试题 JSON
            <textarea
              className="code-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button
            className="primary wide"
            onClick={() => {
              try {
                const cases = JSON.parse(draft);
                void post("/datasets", { name, cases })
                  .then((r) => {
                    setSelected(r.id);
                    setEditing(false);
                    refresh();
                    notify("已保存为新的测试集版本。");
                  })
                  .catch((e) => notify(e.message));
              } catch {
                notify("测试集 JSON 格式不正确。");
              }
            }}
          >
            保存新版本
          </button>
        </Modal>
      )}
      {detail && (
        <Modal
          title={`配置 ${detail.config} · 逐题复核`}
          onClose={() => setDetail(null)}
        >
          <h3>{detail.question}</h3>
          <p className="muted">
            身份 {detail.as} · {detail.provider} · {statuses[detail.status]}
          </p>
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {detail.answer}
            </ReactMarkdown>
          </div>
          <Alert>{detail.error}</Alert>
          <p>
            预期关键词：{detail.expected.join("、") || "应拒答"}；实际
            {detail.refused ? "没有证据，已拒答" : "返回了证据"}。
          </p>
          <label>
            人工复核说明
            <textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              maxLength={500}
            />
          </label>
          <div className="actions">
            {[true, false].map((supported) => (
              <button
                key={String(supported)}
                onClick={() =>
                  void post(`/evaluations/${detail.jobId}/review`, {
                    caseId: detail.caseId,
                    config: detail.config,
                    supported,
                    note: review,
                  })
                    .then(() => {
                      setDetail(null);
                      refresh();
                      notify("人工复核已保存。");
                    })
                    .catch((e) => notify(e.message))
                }
              >
                {supported ? "原文支持答案" : "存在无依据结论"}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
