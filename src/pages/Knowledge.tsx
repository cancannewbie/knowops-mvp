import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { User } from "../../shared/contracts";
import { api, base64, post } from "../api";

import { Alert, Badge, Empty, Heading, Modal, time } from "../components/ui";
export function Knowledge({
  user,
  notify,
  refresh,
}: {
  user: User;
  notify: (s: string) => void;
  refresh: () => void;
}) {
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: () => api<any[]>("/documents"),
    refetchInterval: 2000,
  });
  const releases = useQuery({
    queryKey: ["releases"],
    queryFn: () => api<any>("/releases"),
  });
  const [upload, setUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("V2");
  const [visibility, setVisibility] = useState("team");
  const [family, setFamily] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await post("/documents", {
        filename: file.name,
        data: await base64(file),
        title: title || file.name,
        version,
        visibility,
        ...(family ? { familyId: family } : {}),
      });
      setUpload(false);
      setFile(null);
      refresh();
      notify("上传已接收。后台处理状态可在“处理任务”查看。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const currentIds =
    releases.data?.items.find((r: any) => r.id === releases.data.current)
      ?.doc_ids ?? [];
  const action = async (fn: () => Promise<any>, message: string) => {
    try {
      await fn();
      refresh();
      notify(message);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <>
      <Heading
        eyebrow="KNOWLEDGE LIBRARY"
        title="资料与知识发布"
        description="保留每次修订。处理完成后，选择资料组成一份新的发布清单。"
      >
        {user.role === "admin" && (
          <button className="primary" onClick={() => setUpload(true)}>
            ＋ 上传资料
          </button>
        )}
      </Heading>
      <Alert>{docs.error?.message}</Alert>
      <section className="card">
        <div className="section-title">
          <h3>
            可访问的资料 <span>{docs.data?.length ?? 0}</span>
          </h3>
          <small>
            当前发布：
            {releases.data?.items.find(
              (r: any) => r.id === releases.data.current,
            )?.label ?? "尚未发布"}
          </small>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {user.role === "admin" && <th>选择</th>}
                <th>资料名称</th>
                <th>产品版本</th>
                <th>状态</th>
                <th>范围</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.data?.map((d) => (
                <tr key={d.id}>
                  {user.role === "admin" && (
                    <td>
                      <input
                        aria-label={`选择 ${d.title}`}
                        type="checkbox"
                        disabled={d.status !== "ready"}
                        checked={selected.includes(d.id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, d.id]
                              : s.filter((id) => id !== d.id),
                          )
                        }
                      />
                    </td>
                  )}
                  <td>
                    <strong>{d.title}</strong>
                    <small>
                      修订 {d.revision} · {d.chunk_count} 个片段{" "}
                      {currentIds.includes(d.id) && "· 当前已发布"}
                    </small>
                  </td>
                  <td>
                    <span className="tag">
                      {d.product_version === "*" ? "通用" : d.product_version}
                    </span>
                  </td>
                  <td>
                    <Badge status={d.status} />
                  </td>
                  <td>{d.visibility === "ops" ? "仅运维" : "团队共享"}</td>
                  <td>
                    <button
                      onClick={() =>
                        void action(
                          async () =>
                            setPreview(await api(`/documents/${d.id}`)),
                          "",
                        )
                      }
                    >
                      预览
                    </button>
                    {user.role === "admin" && (
                      <button
                        className="link"
                        onClick={() =>
                          void action(
                            () =>
                              api(`/documents/${d.id}/visibility`, {
                                method: "PATCH",
                                body: JSON.stringify({
                                  visibility:
                                    d.visibility === "ops" ? "team" : "ops",
                                }),
                              }),
                            "资料权限已更新，后续访问将重新校验。",
                          )
                        }
                      >
                        {d.visibility === "ops" ? "设为共享" : "设为运维"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!docs.data?.length && <Empty>还没有可访问资料。</Empty>}
        {user.role === "admin" && (
          <div className="publish-bar">
            <span>已选 {selected.length} 份</span>
            <input
              aria-label="发布名称"
              placeholder="发布名称，例如：产品支持知识 V2"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <button
              onClick={() =>
                setSelected(
                  docs.data
                    ?.filter((d) => d.status === "ready")
                    .filter(
                      (d, _, arr) =>
                        !arr.some(
                          (other) =>
                            other.family_id === d.family_id &&
                            other.revision > d.revision,
                        ),
                    )
                    .map((d) => d.id) ?? [],
                )
              }
            >
              选择最新就绪资料
            </button>
            <button
              className="primary"
              disabled={!selected.length || !label.trim()}
              onClick={() =>
                void action(
                  () => post("/releases", { ids: selected, label }),
                  "知识发布已切换，新问答将使用该清单。",
                )
              }
            >
              发布清单
            </button>
          </div>
        )}
      </section>
      <section className="card">
        <h3>历史发布</h3>
        {releases.data?.items.map((r: any) => (
          <div className="release-row" key={r.id}>
            <div>
              <strong>{r.label}</strong>
              <small>
                {time(r.created_at)} · 可访问资料 {r.doc_ids.length} 份
              </small>
            </div>
            {r.id === releases.data.current ? (
              <span className="badge completed">当前使用</span>
            ) : user.role === "admin" ? (
              <button
                onClick={() =>
                  void action(
                    () => post(`/releases/${r.id}/activate`),
                    "已回退到所选发布。历史问答仍绑定原发布。",
                  )
                }
              >
                切换到此版本
              </button>
            ) : (
              <span className="muted">历史版本</span>
            )}
          </div>
        ))}
      </section>
      {upload && (
        <Modal title="上传知识资料" onClose={() => setUpload(false)}>
          <form onSubmit={submit}>
            <p className="muted">支持 .md / .txt / 文本 PDF，单文件 ≤ 5 MB。</p>
            <label>
              文件
              <input
                type="file"
                accept=".md,.txt,.pdf"
                required
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f) setTitle(f.name.replace(/\.[^.]+$/, ""));
                }}
              />
            </label>
            <label>
              资料名称
              <input
                value={title}
                required
                maxLength={150}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="two-cols">
              <label>
                产品版本
                <select
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {["V1", "V2", "V3", "*"].map((v) => (
                    <option key={v} value={v}>
                      {v === "*" ? "通用" : v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                访问范围
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                >
                  <option value="team">团队共享</option>
                  <option value="ops">仅运维</option>
                </select>
              </label>
            </div>
            <label>
              修订对象
              <select
                value={family}
                onChange={(e) => setFamily(e.target.value)}
              >
                <option value="">新建独立资料</option>
                {docs.data
                  ?.filter(
                    (d, i, arr) =>
                      arr.findIndex((x) => x.family_id === d.family_id) === i,
                  )
                  .map((d) => (
                    <option key={d.family_id} value={d.family_id}>
                      {d.title}
                    </option>
                  ))}
              </select>
            </label>
            <Alert>{error}</Alert>
            <button className="primary wide" disabled={busy}>
              {busy ? "正在上传…" : "上传并开始处理"}
            </button>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal
          title={`${preview.title} · 修订 ${preview.revision}`}
          onClose={() => setPreview(null)}
        >
          <p className="muted">
            {preview.filename} · {preview.product_version} ·{" "}
            {preview.chunks.length} 个片段
          </p>
          {preview.filename.endsWith(".pdf") && (
            <a
              className="button"
              href={`/api/documents/${preview.id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              打开原始 PDF ↗
            </a>
          )}
          {preview.chunks.length ? (
            preview.chunks.map((c: any) => (
              <article className="source" key={c.id}>
                <small>
                  {c.page ? `第 ${c.page} 页` : `第 ${c.paragraph} 段`} ·{" "}
                  {c.index_key.startsWith("local")
                    ? "本地特征向量"
                    : "真实向量"}
                </small>
                <pre>{c.text_content}</pre>
              </article>
            ))
          ) : (
            <Empty>尚无处理产物，请检查任务状态。</Empty>
          )}
        </Modal>
      )}
    </>
  );
}
