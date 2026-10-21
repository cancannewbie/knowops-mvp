import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createApplication } from "../server/app";
import { until } from "./support";
import { terminal } from "../shared/contracts";

test("R03/R04: revoke during remote retrieval; cancelled ingestion attempt cannot overwrite retry", async () => {
  const ctx = await createApplication();
  const appServer = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => appServer.once("listening", r));
  const address = appServer.address();
  const apiBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api`;
  let holdQuery = false,
    holdIngest = false;
  let heldResponse: ServerResponse | undefined;
  let generationCalls = 0;
  let embeddedRequestSeen = false;
  const fake = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    if (req.url === "/embeddings") {
      if (
        (holdQuery && input.input === "BOUNDARY_CODE 怎么处理？") ||
        (holdIngest && input.input.includes("SLOW_INGEST"))
      ) {
        heldResponse = res;
        embeddedRequestSeen = true;
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }));
      return;
    }
    generationCalls++;
    res.setHeader("Content-Type", "text/event-stream");
    res.end(
      'data: {"choices":[{"delta":{"content":"先检查再重试 [S1]"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
  });
  fake.listen(0, "127.0.0.1");
  await new Promise<void>((r) => fake.once("listening", r));
  const port = (fake.address() as { port: number }).port;
  const saved = { ...process.env };
  Object.assign(process.env, {
    EMBEDDING_API_BASE: `http://127.0.0.1:${port}`,
    EMBEDDING_API_KEY: "controlled-test-only",
    EMBEDDING_MODEL: "fenced-fixture",
    GENERATION_MODE: "openai-compatible",
    MODEL_API_BASE: `http://127.0.0.1:${port}`,
    MODEL_API_KEY: "controlled-test-only",
    MODEL_NAME: "fenced-fixture",
  });
  try {
    const admin = await ctx.engine.user("admin");
    const member = await ctx.engine.user("member");
    const upload = await ctx.engine.upload(admin, {
      filename: "boundary.md",
      title: "并发边界资料",
      version: "V2",
      visibility: "team",
      data: Buffer.from("BOUNDARY_CODE 处理方法：先检查再重试。").toString(
        "base64",
      ),
    });
    await until(
      async () =>
        (
          await ctx.db.query<any>("SELECT status FROM jobs WHERE id=$1", [
            upload.jobId,
          ])
        ).rows[0].status,
      (s) => s === "ready",
    );
    await ctx.engine.publish(admin, [upload.id], "权限边界发布");
    holdQuery = true;
    const run = await ctx.engine.createRun(member, {
      question: "BOUNDARY_CODE 怎么处理？",
      version: "V2",
      config: "B",
      conversationId: "boundary",
      idempotencyKey: randomUUID(),
    });
    await until(async () => embeddedRequestSeen, Boolean);
    await ctx.engine.setVisibility(admin, upload.id, "ops");
    const failed = await until(
      async () =>
        (await ctx.db.query<any>("SELECT * FROM runs WHERE id=$1", [run.id]))
          .rows[0],
      (r) => terminal(r.status),
    );
    assert.equal(failed.status, "failed");
    assert.equal(generationCalls, 0);
    assert.deepEqual(failed.refs, []);
    holdQuery = false;
    heldResponse?.end(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }));
    await ctx.engine.setVisibility(admin, upload.id, "team");
    const control = await ctx.engine.createRun(member, {
      question: "BOUNDARY_CODE 怎么处理？",
      version: "V2",
      config: "B",
      conversationId: "boundary",
      idempotencyKey: randomUUID(),
    });
    const success = await until(
      async () =>
        (
          await ctx.db.query<any>("SELECT * FROM runs WHERE id=$1", [
            control.id,
          ])
        ).rows[0],
      (r) => terminal(r.status),
    );
    assert.equal(success.status, "completed");
    assert.equal(generationCalls, 1);
    const login = await fetch(apiBase + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.test",
        password: "DemoPass123!",
      }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    embeddedRequestSeen = false;
    holdIngest = true;
    const slow = await ctx.engine.upload(admin, {
      filename: "slow.md",
      title: "重试尝试隔离",
      version: "V2",
      visibility: "team",
      data: Buffer.from("SLOW_INGEST 处理结果只允许提交一次。").toString(
        "base64",
      ),
    });
    await until(async () => embeddedRequestSeen, Boolean);
    const cancel = await fetch(`${apiBase}/jobs/${slow.jobId}/cancel`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(cancel.status, 200);
    const retry = await fetch(`${apiBase}/jobs/${slow.jobId}/retry`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(retry.status, 200);
    holdIngest = false;
    heldResponse?.end(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }));
    const complete = await until(
      async () =>
        (
          await ctx.db.query<any>(
            "SELECT j.status,j.attempts,d.status AS doc_status FROM jobs j JOIN documents d ON d.id=j.doc_id WHERE j.id=$1",
            [slow.jobId],
          )
        ).rows[0],
      (r) => r.status === "ready",
    );
    assert.equal(complete.attempts, 2);
    assert.equal(complete.doc_status, "ready");
    assert.equal(
      (await ctx.db.query("SELECT id FROM chunks WHERE doc_id=$1", [slow.id]))
        .rows.length,
      1,
    );
    const lateCancel = await fetch(`${apiBase}/jobs/${slow.jobId}/cancel`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(lateCancel.status, 409);
  } finally {
    heldResponse?.end();
    for (const key of [
      "EMBEDDING_API_BASE",
      "EMBEDDING_API_KEY",
      "EMBEDDING_MODEL",
      "GENERATION_MODE",
      "MODEL_API_BASE",
      "MODEL_API_KEY",
      "MODEL_NAME",
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fake.closeAllConnections();
    appServer.closeAllConnections();
    await new Promise<void>((r) => fake.close(() => r()));
    await new Promise<void>((r) => appServer.close(() => r()));
    await ctx.engine.close();
  }
});
