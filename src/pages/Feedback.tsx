import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, post } from "../api";

import { Alert, Empty, Heading, Modal, time } from "../components/ui";
export function Feedback({
  go,
  notify,
  refresh,
}: {
  go: (p: string) => void;
  notify: (message: string) => void;
  refresh: () => void;
}) {
  const list = useQuery({
    queryKey: ["feedback"],
    queryFn: () => api<any[]>("/feedback"),
  });
  const datasets = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api<any[]>("/datasets"),
  });
  const [selected, setSelected] = useState<any>(null);
  const [expected, setExpected] = useState("");
  const [refuse, setRefuse] = useState(false);
  const [as, setAs] = useState("member");
  const [error, setError] = useState("");
  async function addCase() {
    try {
      const dataset = datasets.data?.[0];
      const keywords = expected
        .split(/[,，、]/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!refuse && !keywords.length) {
        setError("请填写至少一个需要人工确认的预期关键词。");
        return;
      }
      await post("/datasets", {
        name: dataset?.name ?? "反馈回归集",
        cases: [
          ...(dataset?.cases ?? []),
          {
            id: "feedback-" + crypto.randomUUID().slice(0, 8),
            question: selected.question,
            version: selected.product_version,
            as,
            expected: refuse ? [] : keywords,
            refuse,
          },
        ],
      });
      setSelected(null);
      refresh();
      notify("反馈已加入测试集新版本，可开始回归评测。");
      go("evaluation");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Heading
        eyebrow="FEEDBACK INBOX"
        title="把反馈变成下一次改进"
        description="先定位错误来源，再将问题加入新版本测试集。"
      />
      <Alert>{list.error?.message}</Alert>
      <section className="card">
        {list.data?.length ? (
          list.data.map((f) => (
            <article className="job" key={f.id}>
              <div>
                <h3>{f.question}</h3>
                <p>{f.reason || "用户未补充说明"}</p>
                <small>
                  {f.product_version} · {time(f.created_at)}
                </small>
              </div>
              <span className={`badge ${f.useful ? "completed" : "failed"}`}>
                {f.useful ? "有帮助" : "需要改进"}
              </span>
              <button
                onClick={() => {
                  setSelected(f);
                  setExpected("");
                  setRefuse(false);
                  setAs("member");
                  setError("");
                }}
              >
                加入测试集 →
              </button>
            </article>
          ))
        ) : (
          <Empty>还没有反馈。在回答下点击“有帮助”或“反馈问题”。</Empty>
        )}
      </section>
      {selected && (
        <Modal title="将反馈转为回归测试题" onClose={() => setSelected(null)}>
          <h3>{selected.question}</h3>
          <p className="muted">新题将加入测试集的新版本，不覆盖已有版本。</p>
          <label>
            执行身份
            <select value={as} onChange={(e) => setAs(e.target.value)}>
              <option value="member">支持专员</option>
              <option value="admin">运维管理者</option>
            </select>
          </label>
          <label>
            预期行为
            <select
              value={String(refuse)}
              onChange={(e) => setRefuse(e.target.value === "true")}
            >
              <option value="false">应返回有依据的答案</option>
              <option value="true">资料不足，应拒答</option>
            </select>
          </label>
          {!refuse && (
            <label>
              预期关键词（逗号分隔）
              <input
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="例如：2000，CSV，组织管理员"
              />
            </label>
          )}
          <Alert>{error}</Alert>
          <button className="primary wide" onClick={() => void addCase()}>
            保存回归题与新版本
          </button>
        </Modal>
      )}
    </>
  );
}
