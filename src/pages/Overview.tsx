import { useQuery } from "@tanstack/react-query";
import type { Run } from "../../shared/contracts";
import { api } from "../api";

import { Heading } from "../components/ui";
export function Overview({
  go,
  mode,
  embedding,
}: {
  go: (p: string) => void;
  mode: string;
  embedding: string;
}) {
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: () => api<any[]>("/documents"),
  });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Run[]>("/runs"),
  });
  const releases = useQuery({
    queryKey: ["releases"],
    queryFn: () => api<any>("/releases"),
  });
  return (
    <>
      <Heading
        eyebrow="YOUR KNOWLEDGE OPERATIONS"
        title="每个答案，都可以向前追溯。"
        description="围绕同一份知识发布，查看资料、核对证据，再用测试题验证改动。"
      />
      <div className="stats">
        {[
          ["可访问资料", docs.data?.length ?? 0, "修订独立保留"],
          [
            "已就绪资料",
            docs.data?.filter((d) => d.status === "ready").length ?? 0,
            "处理完成后手动发布",
          ],
          ["我的问答", runs.data?.length ?? 0, "含完成与中断记录"],
          ["知识发布", releases.data?.items.length ?? 0, "可回退至历史清单"],
        ].map(([label, value, hint]) => (
          <div className="stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="hero">
        <div>
          <span className="pill">端到端演示路线</span>
          <h2>从一份手册，走到一次可解释的回答。</h2>
          <p>
            已准备 V1 / V2 导入手册、错误码与权限资料。
            <br />
            先问“V2 成员导入限制是多少”，再点击引用核对原文。
          </p>
          <button className="primary" onClick={() => go("chat")}>
            开始证据问答 ↗
          </button>
        </div>
        <div className="route-card">
          <div>
            <b>01</b>
            <span>
              资料入库<small>解析 · 切分 · 向量查询</small>
            </span>
            <i>✓</i>
          </div>
          <div>
            <b>02</b>
            <span>
              问答追溯<small>流式输出 · 修订引用</small>
            </span>
            <i>→</i>
          </div>
          <div>
            <b>03</b>
            <span>
              质量对照<small>A/B 配置 · 人工复核</small>
            </span>
            <i>→</i>
          </div>
        </div>
      </div>
      <div className="two-cols">
        <section className="card">
          <h3>当前运行方式</h3>
          <dl>
            <dt>回答生成</dt>
            <dd>
              {mode === "extractive-demo"
                ? "确定性原文摘录（演示）"
                : "OpenAI-compatible 服务端适配"}
            </dd>
            <dt>检索索引</dt>
            <dd>{embedding}</dd>
            <dt>持久化</dt>
            <dd>PGlite + pgvector · 单进程本地 Postgres</dd>
          </dl>
          <p className="callout">
            演示模式用于验证产品链路。规则命中率不代表真实模型准确率。
          </p>
        </section>
        <section className="card">
          <h3>三个值得验证的边界</h3>
          <ul className="checklist">
            <li>处理完成 ≠ 已发布可检索</li>
            <li>引用存在 ≠ 答案结论已被证实</li>
            <li>网络连接关闭 ≠ 生成已成功完成</li>
          </ul>
          <button className="link" onClick={() => go("knowledge")}>
            查看资料与发布清单 →
          </button>
        </section>
      </div>
    </>
  );
}
