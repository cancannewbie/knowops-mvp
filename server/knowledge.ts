import { hash } from "./db";
import type { DB } from "./db";
import type { Source, User } from "../shared/contracts";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new AppError(status, code, message);
};
export const allowed = (
  user: User,
  doc: { workspace_id: string; visibility: string },
) =>
  doc.workspace_id === user.workspace_id &&
  (doc.visibility === "team" || user.role === "admin");
export function tokens(text: string) {
  const normalized = text.toLowerCase().replace(/v[123]/g, "");
  const latin = normalized.match(/[a-z_][a-z0-9_]+|\d+/g) ?? [];
  const chinese = (normalized.match(/[\u4e00-\u9fff]+/g) ?? []).flatMap((s) =>
    Array.from({ length: Math.max(s.length - 1, 0) }, (_, i) =>
      s.slice(i, i + 2),
    ),
  );
  return [...new Set([...latin, ...chinese])].filter(
    (t) =>
      ![
        "什么",
        "怎么",
        "如何",
        "多少",
        "可以",
        "是否",
        "哪些",
        "请问",
        "一次",
        "成员",
      ].includes(t),
  );
}
export function localVector(text: string) {
  const a = Array(48).fill(0) as number[];
  for (const token of tokens(text)) {
    const h = hash(token);
    a[parseInt(h.slice(0, 4), 16) % 48] +=
      parseInt(h.slice(4, 6), 16) % 2 ? 1 : -1;
  }
  const norm = Math.sqrt(a.reduce((s, n) => s + n * n, 0)) || 1;
  return a.map((x) => x / norm);
}
export async function embedding(
  text: string,
  signal?: AbortSignal,
): Promise<{ vector: number[]; key: string }> {
  const {
    EMBEDDING_API_BASE: base,
    EMBEDDING_API_KEY: key,
    EMBEDDING_MODEL: model,
  } = process.env;
  if (!base && !key && !model)
    return { vector: localVector(text), key: "local-feature-48-v1" };
  if (!base || !key || !model)
    throw new AppError(
      503,
      "EMBEDDING_CONFIG",
      "Embedding 配置不完整，请填写 BASE、KEY、MODEL",
    );
  const dimensions = process.env.EMBEDDING_DIMENSIONS
    ? Number(process.env.EMBEDDING_DIMENSIONS)
    : undefined;
  const response = await fetch(`${base.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
      ...(dimensions ? { dimensions } : {}),
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new AppError(
      502,
      response.status === 429 ? "EMBEDDING_RATE_LIMIT" : "EMBEDDING_PROVIDER",
      `向量服务返回 ${response.status}，请检查配置后重试`,
    );
  const json = (await response.json()) as { data?: { embedding?: number[] }[] };
  const vector = json.data?.[0]?.embedding;
  if (
    !vector ||
    !vector.length ||
    vector.length > 4096 ||
    vector.some((v) => !Number.isFinite(v))
  )
    throw new AppError(502, "EMBEDDING_FORMAT", "向量服务返回了无效结果");
  return {
    vector,
    key: `remote:${hash(`${base}|${model}|${vector.length}`).slice(0, 20)}`,
  };
}
export type Part = { text: string; page: number | null; paragraph: number };
export async function parseFile(
  filename: string,
  raw: string,
): Promise<Part[]> {
  const bytes = Buffer.from(raw, "base64");
  if (filename.toLowerCase().endsWith(".pdf")) {
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      throw new AppError(422, "PDF_INVALID", "文件不是有效 PDF，请重新上传");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    }).promise;
    const parts: Part[] = [];
    try {
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        const text = content.items
          .map((item) =>
            "str" in item
              ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ")
              : "",
          )
          .join("")
          .trim();
        if (text) parts.push({ text, page, paragraph: page });
      }
    } finally {
      await pdf.destroy();
    }
    if (!parts.length)
      throw new AppError(
        422,
        "OCR_REQUIRED",
        "此 PDF 没有可提取文字，需要 OCR；当前 MVP 不包含 OCR",
      );
    return parts;
  }
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/\r\n/g, "\n");
  if (!text.trim())
    throw new AppError(422, "EMPTY_DOCUMENT", "资料为空，请上传包含文字的文件");
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((text, i) => ({ text: text.trim(), page: null, paragraph: i + 1 }));
}
export function splitParts(parts: Part[]): Part[] {
  const chunks: Part[] = [];
  let heading = "";
  for (const part of parts) {
    if (/^#{1,6} /.test(part.text) && !part.text.includes("\n")) {
      heading = part.text;
      continue;
    }
    for (let i = 0; i < part.text.length; i += 700) {
      chunks.push({
        ...part,
        text: (heading ? heading + "\n" : "") + part.text.slice(i, i + 800),
      });
    }
  }
  if (!chunks.length && heading)
    chunks.push({ text: heading, page: null, paragraph: 1 });
  return chunks;
}
export async function retrieve(
  db: DB,
  user: User,
  question: string,
  version: string,
  releaseId: string,
  config: string,
  signal?: AbortSignal,
) {
  const release = (
    await db.query<{ doc_ids: string[] }>(
      "SELECT doc_ids FROM releases WHERE id=$1",
      [releaseId],
    )
  ).rows[0];
  if (!release)
    throw new AppError(404, "RELEASE_NOT_FOUND", "知识发布版本不存在");
  const embedded = await embedding(question, signal);
  // The bounded demo library ranks the full authorized set, so lexical matches
  // cannot be discarded by a vector-only candidate cutoff.
  const result = await db.query<{
    id: string;
    doc_id: string;
    text_content: string;
    page: number | null;
    paragraph: number;
    title: string;
    revision: number;
    distance: number;
  }>(
    `SELECT c.id,c.doc_id,c.text_content,c.page,c.paragraph,d.title,d.revision,1-(c.embedding <=> $1::vector) AS distance FROM chunks c JOIN documents d ON d.id=c.doc_id WHERE d.id=ANY($2::text[]) AND d.workspace_id=$3 AND (d.visibility='team' OR $4='admin') AND d.product_version IN ($5,'*') AND c.index_key=$6 ORDER BY c.embedding <=> $1::vector`,
    [
      JSON.stringify(embedded.vector),
      release.doc_ids,
      user.workspace_id,
      user.role,
      version,
      embedded.key,
    ],
  );
  const words = tokens(question);
  const candidates = result.rows
    .map((row) => {
      const body = (row.title + " " + row.text_content).toLowerCase();
      const overlap = words.filter((t) => body.includes(t));
      const exactError = (question.match(/\b[A-Z]+(?:_[A-Z]+)+\b/) ?? []).some(
        (e) => body.includes(e.toLowerCase()),
      );
      const lexical = overlap.length;
      return {
        ...row,
        overlap,
        lexical,
        exactError,
        score:
          config === "A"
            ? Number(row.distance)
            : lexical * 0.5 + (exactError ? 5 : 0) + Number(row.distance) * 0.2,
      };
    })
    .filter((r) => r.exactError || r.lexical >= Math.min(2, words.length || 2))
    .sort((a, b) => b.score - a.score);
  const selected = candidates.slice(0, config === "A" ? 1 : 3);
  const refs: Source[] = selected.map((r, i) => ({
    id: `S${i + 1}`,
    documentId: r.doc_id,
    title: r.title,
    revision: r.revision,
    chunkId: r.id,
    page: r.page,
    paragraph: r.paragraph,
    text: r.text_content,
    score: Math.round(r.score * 1000) / 1000,
  }));
  return {
    refs,
    trace: {
      workspace: user.workspace_id,
      role: user.role,
      productVersion: version,
      releaseId,
      config,
      indexKey: embedded.key,
      mode:
        embedded.key === "local-feature-48-v1"
          ? "本地特征向量演示（不代表语义模型）"
          : "已配置真实 Embedding",
      filter: "空间 + 当前资料权限 + 产品版本 + 发布清单 + 索引配置",
      candidates: candidates.map((c) => ({
        chunkId: c.id,
        title: c.title,
        score: c.score,
        matched: c.overlap,
        text: c.text_content,
      })),
      context: refs,
    },
  };
}
