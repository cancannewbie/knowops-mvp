import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Run, Source } from "../../shared/contracts";
import { api } from "../api";

import { Alert, Empty, Heading, time } from "../components/ui";
export function Debug() {
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Run[]>("/runs"),
  });
  const [id, setId] = useState("");
  const [trace, setTrace] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    let active = true;
    void api(`/runs/${id}/trace`)
      .then((t) => {
        if (active) {
          setTrace(t);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <>
      <Heading
        eyebrow="RETRIEVAL DIAGNOSTICS"
        title="沿着证据定位问题"
        description="先确认解析和召回，再分析生成。检索分数不是答案正确率。"
      />
      <div className="card">
        <label>
          选择问答运行
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">请选择最近的问答</option>
            {runs.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.question} · {r.config} · {time(r.created_at)}
              </option>
            ))}
          </select>
        </label>
        <Alert>{error}</Alert>
        {trace ? (
          <>
            <div className="facts">
              <span>
                空间 <b>{trace.workspace}</b>
              </span>
              <span>
                身份 <b>{trace.role}</b>
              </span>
              <span>
                产品 <b>{trace.productVersion}</b>
              </span>
              <span>
                配置 <b>{trace.config}</b>
              </span>
            </div>
            <p className="callout">授权过滤：{trace.filter}</p>
            <p className="muted">
              索引：{trace.mode} · 检索 {trace.retrievalMs ?? "—"} ms · 首段正文{" "}
              {trace.firstContentMs ?? "—"} ms
            </p>
            <h3>候选片段与匹配依据</h3>
            {trace.candidates?.length ? (
              trace.candidates.map((c: any) => (
                <article className="source" key={c.chunkId}>
                  <strong>{c.title}</strong>
                  <small>
                    排序分数 {Number(c.score).toFixed(3)} · 字面命中：
                    {c.matched.join("、")}
                  </small>
                  <pre>{c.text}</pre>
                </article>
              ))
            ) : (
              <Empty>没有符合当前授权与版本条件的相关片段。</Empty>
            )}
            <h3>最终进入上下文的证据</h3>
            {trace.context?.map((s: Source) => (
              <div className="source" key={s.id}>
                <strong>
                  {s.id} · {s.title}
                </strong>
                <pre>{s.text}</pre>
              </div>
            ))}
            <p className="muted">
              {trace.citationMapping} {trace.usage}
            </p>
          </>
        ) : (
          <Empty>选择运行后查看过滤、候选排序和最终上下文。</Empty>
        )}
      </div>
    </>
  );
}
