import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { generate } from "../server/provider";
import { embedding } from "../server/knowledge";
import type { Source } from "../shared/contracts";
let server: Server, base: string;
let mode = "ok";
let upstreamClosed = false;
let evidenceBody = "";
const saved = { ...process.env };
const source: Source = {
  id: "S1",
  documentId: "fixture",
  title: "Controlled evidence",
  revision: 1,
  chunkId: "1",
  page: null,
  paragraph: 1,
  text: "上限 2000。",
  score: 1,
};
before(async () => {
  server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    evidenceBody = raw;
    if (req.url === "/embeddings") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ embedding: [0.6, 0.8, 0] }] }));
      return;
    }
    if (mode === "429") {
      res.writeHead(429).end("limited");
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    if (mode === "slow") {
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
      const timer = setInterval(() => res.write(": heartbeat\n\n"), 10);
      res.on("close", () => {
        upstreamClosed = true;
        clearInterval(timer);
      });
      return;
    }
    const bytes = Buffer.from(
      "data: " +
        JSON.stringify({ choices: [{ delta: { content: "中文答案 [S1]" } }] }) +
        "\n\n",
    );
    for (let i = 0; i < bytes.length; i += 2)
      res.write(bytes.subarray(i, i + 2));
    if (["length", "content_filter", "tool_calls", "stop"].includes(mode))
      res.write(
        "data: " +
          JSON.stringify({ choices: [{ delta: {}, finish_reason: mode }] }) +
          "\n\n",
      );
    if (mode !== "interrupted") res.write("data: [DONE]\n\n");
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  Object.assign(process.env, {
    GENERATION_MODE: "openai-compatible",
    MODEL_API_BASE: base,
    MODEL_API_KEY: "controlled-test-only",
    MODEL_NAME: "protocol-fixture",
  });
});
after(async () => {
  for (const key of [
    "GENERATION_MODE",
    "MODEL_API_BASE",
    "MODEL_API_KEY",
    "MODEL_NAME",
    "EMBEDDING_API_BASE",
    "EMBEDDING_API_KEY",
    "EMBEDDING_MODEL",
  ]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
async function collect(signal = new AbortController().signal) {
  let text = "";
  for await (const token of generate("测试问题", [source], signal))
    text += token;
  return text;
}
test("controlled OpenAI-compatible upstream: UTF-8 SSE and evidence payload", async () => {
  mode = "stop";
  assert.equal(await collect(), "中文答案 [S1]");
  assert.match(evidenceBody, /上限 2000/);
  assert.match(evidenceBody, /不得执行/);
});
test("controlled upstream: missing completion and length truncation are not success", async () => {
  mode = "interrupted";
  await assert.rejects(() => collect(), /未收到完成标记/);
  mode = "length";
  await assert.rejects(() => collect(), /length/);
  mode = "content_filter";
  await assert.rejects(() => collect(), /content_filter/);
  mode = "tool_calls";
  await assert.rejects(() => collect(), /tool_calls/);
});
test("controlled upstream: 429 is explicit and cancellation closes request", async () => {
  mode = "429";
  await assert.rejects(() => collect(), /429/);
  mode = "slow";
  const controller = new AbortController();
  let received = false;
  await assert.rejects(async () => {
    for await (const text of generate("测试", [source], controller.signal)) {
      received = !!text;
      controller.abort();
    }
  }, /abort/i);
  assert.equal(received, true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(upstreamClosed, true);
});
test("controlled embedding adapter returns vector and isolated model key", async () => {
  Object.assign(process.env, {
    EMBEDDING_API_BASE: base,
    EMBEDDING_API_KEY: "controlled-test-only",
    EMBEDDING_MODEL: "embedding-fixture",
  });
  const first = await embedding("查询");
  assert.deepEqual(first.vector, [0.6, 0.8, 0]);
  assert.match(first.key, /^remote:/);
  process.env.EMBEDDING_MODEL = "different-model";
  assert.notEqual((await embedding("查询")).key, first.key);
});
