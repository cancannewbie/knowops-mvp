export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  workspace_id: string;
};
export type Source = {
  id: string;
  documentId: string;
  title: string;
  revision: number;
  chunkId: string;
  page: number | null;
  paragraph: number;
  text: string;
  score: number;
};
export type RunStatus =
  | "queued"
  | "retrieving"
  | "generating"
  | "verifying"
  | "completed"
  | "cancelled"
  | "failed";
export type RunEvent = {
  runId: string;
  sequence: number;
  type: "status" | "delta" | "sources" | "done" | "error" | "cancelled";
  payload: Record<string, unknown>;
};
export type Run = {
  id: string;
  owner_id: string;
  conversation_id: string;
  question: string;
  product_version: string;
  config: string;
  release_id: string;
  provider: string;
  status: RunStatus;
  answer: string;
  refs: Source[];
  trace: Record<string, unknown>;
  error: string | null;
  created_at: string;
  updated_at: string;
};
export const terminal = (status: string) =>
  ["completed", "cancelled", "failed"].includes(status);
export const statuses: Record<string, string> = {
  queued: "排队中",
  parsing: "解析中",
  chunking: "切分中",
  indexing: "索引中",
  ready: "待发布",
  failed: "失败",
  cancelled: "已取消",
  retrieving: "检索中",
  generating: "生成中",
  verifying: "核验中",
  completed: "已完成",
  running: "进行中",
};
