export async function api<T = any>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `${body.message ?? "请求失败"}${body.requestId ? `（请求 ${body.requestId.slice(0, 8)}）` : ""}`,
    );
  return body;
}
export const post = <T = any>(url: string, data: unknown = {}) =>
  api<T>(url, { method: "POST", body: JSON.stringify(data) });
export async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
