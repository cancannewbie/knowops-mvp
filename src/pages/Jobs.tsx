import { useQuery } from "@tanstack/react-query";
import { api, post } from "../api";

import { Alert, Badge, Empty, Heading, time } from "../components/ui";
export function Jobs({
  notify,
  refresh,
}: {
  notify: (s: string) => void;
  refresh: () => void;
}) {
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<any[]>("/jobs"),
    refetchInterval: 900,
  });
  async function act(id: string, action: string) {
    try {
      await post(`/jobs/${id}/${action}`);
      refresh();
      notify(action === "retry" ? "任务已重新排队" : "任务已取消");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <Heading
        eyebrow="PERSISTENT TASKS"
        title="资料处理任务"
        description="阶段来自服务端实际处理。刷新页面后继续追踪，失败产物不会进入知识发布。"
      />
      <Alert>{jobs.error?.message}</Alert>
      <div className="card">
        <div className="pipeline">排队 → 解析 → 切分 → 索引 → 待发布</div>
        {jobs.data?.map((j) => (
          <article className="job" key={j.id}>
            <div>
              <h3>{j.title}</h3>
              <small>
                尝试 {j.attempts} 次 · {time(j.updated_at)} · {j.id.slice(0, 8)}
              </small>
              {j.error && <Alert>{j.error}</Alert>}
            </div>
            <Badge status={j.status} />
            {["failed", "cancelled"].includes(j.status) ? (
              <button onClick={() => void act(j.id, "retry")}>重试任务</button>
            ) : (
              j.status !== "ready" && (
                <button onClick={() => void act(j.id, "cancel")}>取消</button>
              )
            )}
          </article>
        ))}
        {!jobs.data?.length && <Empty>暂无处理任务，先上传一份资料。</Empty>}
      </div>
    </>
  );
}
