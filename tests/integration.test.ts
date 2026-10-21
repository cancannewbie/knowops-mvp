import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createApplication } from "../server/app";
import { until } from "./support";
import { terminal } from "../shared/contracts";
import { SSEDecoder } from "../shared/sse";
import { localVector, retrieve } from "../server/knowledge";
let ctx: Awaited<ReturnType<typeof createApplication>>,
  server: Server,
  base: string,
  adminCookie: string,
  memberCookie: string,
  originalRelease: string;
async function request(
  url: string,
  cookie = adminCookie,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(base + url, {
    method,
    headers: { Cookie: cookie ?? "", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}
async function makeRun(
  question: string,
  version = "V2",
  cookie = memberCookie,
  extra: Record<string, unknown> = {},
) {
  return request("/runs", cookie, "POST", {
    question,
    version,
    config: "B",
    conversationId: "test-conversation",
    idempotencyKey: randomUUID(),
    ...extra,
  });
}
async function finished(id: string, cookie = memberCookie) {
  return until(
    async () => {
      const r = await request(`/runs/${id}`, cookie);
      return r.body;
    },
    (r) => terminal(r.status),
  );
}
before(async () => {
  ctx = await createApplication();
  server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api`;
  for (const role of ["admin", "member"]) {
    const r = await request("/login", "", "POST", {
      email: `${role}@example.test`,
      password: "DemoPass123!",
    });
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    if (role === "admin") adminCookie = cookie;
    else memberCookie = cookie;
  }
  originalRelease = (await request("/releases")).body.current;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await ctx.engine.close();
});

test("session enforcement, role headers do not confer access, source isolation", async () => {
  const spoof = await fetch(base + "/jobs", {
    headers: { Cookie: memberCookie, "X-Role": "admin", "X-User-Id": "admin" },
  });
  assert.equal(spoof.status, 403);
  assert.equal((await request("/documents", "")).status, 401);
  assert.equal((await request("/jobs", memberCookie)).status, 403);
  const docs = (await request("/documents", memberCookie)).body;
  assert.ok(!docs.some((d: any) => d.visibility === "ops"));
  const ops = (await request("/documents")).body.find(
    (d: any) => d.visibility === "ops",
  );
  assert.equal(
    (await request(`/documents/${ops.id}`, memberCookie)).status,
    404,
  );
  const denied = await makeRun("客户部署有什么特殊配置？");
  const answer = await finished(denied.body.id);
  assert.equal(answer.refs.length, 0);
  assert.match(answer.answer, /资料不足/);
  assert.doesNotMatch(JSON.stringify(answer), /ops-only-secret/);
});
test("product version retrieval, refusal, references and immutable historical source", async () => {
  const r1 = await makeRun("成员导入限制是多少？", "V1");
  const a1 = await finished(r1.body.id);
  assert.match(a1.answer, /1000/);
  assert.doesNotMatch(a1.answer, /2000/);
  const r2 = await makeRun("成员导入限制是多少？", "V2");
  const a2 = await finished(r2.body.id);
  assert.match(a2.answer, /2000/);
  assert.equal(a2.provider, "extractive-demo");
  assert.deepEqual(a2.trace, {});
  const source = await request(`/runs/${a2.id}/sources/S1`, memberCookie);
  assert.equal(source.status, 200);
  assert.equal(source.body.revision, 1);
  assert.equal(
    (await request(`/runs/${a2.id}/sources/S999`, memberCookie)).status,
    404,
  );
  const absent = await makeRun("V3 支持自动合并账户吗？", "V3");
  assert.match((await finished(absent.body.id)).answer, /资料不足/);
});
test("idempotency repeats exact run, conflicts with changed payload and hides trace on all responses", async () => {
  const key = randomUUID();
  const a = await makeRun(
    "IMPORT_EMAIL_DUPLICATE 怎么处理？",
    "V2",
    memberCookie,
    { idempotencyKey: key },
  );
  await finished(a.body.id);
  const b = await makeRun(
    "IMPORT_EMAIL_DUPLICATE 怎么处理？",
    "V2",
    memberCookie,
    { idempotencyKey: key },
  );
  assert.equal(a.body.id, b.body.id);
  assert.deepEqual(b.body.trace, {});
  const cancel = await request(
    `/runs/${a.body.id}/cancel`,
    memberCookie,
    "POST",
  );
  assert.equal(cancel.body.status, "completed");
  assert.deepEqual(cancel.body.trace, {});
  const conflict = await makeRun("不同问题", "V2", memberCookie, {
    idempotencyKey: key,
  });
  assert.equal(conflict.status, 409);
  const parallelKey = randomUUID();
  const pair = await Promise.all([
    makeRun("问题一", "V2", memberCookie, { idempotencyKey: parallelKey }),
    makeRun("问题二", "V2", memberCookie, { idempotencyKey: parallelKey }),
  ]);
  assert.deepEqual(pair.map((r) => r.status).sort(), [201, 409]);
  const sameKey = randomUUID();
  const identical = await Promise.all([
    makeRun("同一个问题", "V2", memberCookie, { idempotencyKey: sameKey }),
    makeRun("同一个问题", "V2", memberCookie, { idempotencyKey: sameKey }),
  ]);
  assert.equal(identical[0].body.id, identical[1].body.id);
  assert.ok(identical.every((r) => r.status === 201));
  const list = await request("/runs", memberCookie);
  assert.ok(list.body.every((r: any) => Object.keys(r.trace).length === 0));
  assert.deepEqual(
    (await request(`/runs/${a.body.id}`, memberCookie)).body.trace,
    {},
  );
  assert.equal(
    (await request(`/runs/${a.body.id}/trace`, memberCookie)).status,
    403,
  );
});

test("R06: exact error-code candidate survives more than 30 better vector matches", async () => {
  const user = await ctx.engine.user("member");
  const doc = (await request("/documents", memberCookie)).body.find(
    (d: any) => d.product_version === "V2",
  );
  const question = "ERROR_DEEP_CODE 怎么处理？";
  const v = localVector(question);
  const ids: string[] = [];
  try {
    for (let i = 0; i < 35; i++) {
      const id = `deep-fixture-${i}`;
      ids.push(id);
      await ctx.db.query(
        "INSERT INTO chunks VALUES($1,$2,$3,$4,NULL,1,$5::vector,$6)",
        [
          id,
          doc.id,
          1000 + i,
          "完全不相关的占位资料",
          JSON.stringify(v),
          "local-feature-48-v1",
        ],
      );
    }
    const target = "deep-exact-target";
    ids.push(target);
    await ctx.db.query(
      "INSERT INTO chunks VALUES($1,$2,2000,$3,NULL,1,$4::vector,$5)",
      [
        target,
        doc.id,
        "ERROR_DEEP_CODE 解决步骤：先校验映射再重试。",
        JSON.stringify(v.map((x) => -x)),
        "local-feature-48-v1",
      ],
    );
    const result = await retrieve(
      ctx.db,
      user,
      question,
      "V2",
      originalRelease,
      "B",
    );
    assert.ok(result.refs.some((r) => r.chunkId === target));
  } finally {
    await ctx.db.query("DELETE FROM chunks WHERE id=ANY($1::text[])", [ids]);
  }
});

test("R08: server connection errors do not fabricate or persist business events", async () => {
  const created = await makeRun("IMPORT_EMAIL_DUPLICATE 怎么处理？");
  const run = await finished(created.body.id);
  const eventsBefore = (
    await ctx.db.query("SELECT * FROM events WHERE run_id=$1", [run.id])
  ).rows.length;
  const original = ctx.db.query;
  let injected = false;
  (ctx.db as any).query = async function (sql: string, ...args: any[]) {
    if (!injected && sql.startsWith("SELECT sequence,type,payload")) {
      injected = true;
      throw new Error("controlled event transport failure");
    }
    return (original as any).call(ctx.db, sql, ...args);
  };
  let text = "";
  try {
    const response = await fetch(`${base}/runs/${run.id}/events?after=0`, {
      headers: { Cookie: memberCookie },
    });
    text = await response.text();
  } finally {
    ctx.db.query = original;
  }
  assert.match(text, /transport-error/);
  assert.doesNotMatch(text, /"sequence"/);
  assert.equal(
    (await ctx.db.query("SELECT * FROM events WHERE run_id=$1", [run.id])).rows
      .length,
    eventsBefore,
  );
  const replay = await fetch(`${base}/runs/${run.id}/events?after=0`, {
    headers: { Cookie: memberCookie },
  });
  const events = new SSEDecoder().push(
    new Uint8Array(await replay.arrayBuffer()),
  );
  assert.equal(events[0].sequence, 1);
  assert.equal(events.at(-1)?.type, "done");
});
test("SSE durable event replay matches answer, cursor excludes acknowledged events", async () => {
  const created = await makeRun("IMPORT_EMAIL_DUPLICATE 怎么处理？");
  const run = await finished(created.body.id);
  const response = await fetch(`${base}/runs/${run.id}/events?after=0`, {
    headers: { Cookie: memberCookie },
  });
  const all = new SSEDecoder().push(
    new Uint8Array(await response.arrayBuffer()),
  );
  assert.ok(all.length > 4);
  assert.equal(all.at(-1)?.type, "done");
  assert.equal(
    all
      .filter((e) => e.type === "delta")
      .map((e) => e.payload.text)
      .join(""),
    run.answer,
  );
  const cursor = all[2].sequence;
  const second = await fetch(`${base}/runs/${run.id}/events?after=${cursor}`, {
    headers: { Cookie: memberCookie },
  });
  const replay = new SSEDecoder().push(
    new Uint8Array(await second.arrayBuffer()),
  );
  assert.deepEqual(
    replay,
    all.filter((e) => e.sequence > cursor),
  );
});
test("cancellation is terminal and prevents later deltas", async () => {
  const created = await makeRun("成员导入限制、格式和管理员角色是什么？");
  await until(
    () => request(`/runs/${created.body.id}`, memberCookie),
    (r) => r.body.status === "generating",
  );
  const cancelled = await request(
    `/runs/${created.body.id}/cancel`,
    memberCookie,
    "POST",
  );
  assert.equal(cancelled.body.status, "cancelled");
  await new Promise((r) => setTimeout(r, 150));
  const last = (await request(`/runs/${created.body.id}`, memberCookie)).body;
  assert.equal(last.status, "cancelled");
  assert.equal(last.answer, cancelled.body.answer);
  const events = (
    await ctx.db.query<{ type: string }>(
      "SELECT type FROM events WHERE run_id=$1 ORDER BY sequence",
      [created.body.id],
    )
  ).rows;
  assert.equal(events.at(-1)?.type, "cancelled");
});
test("upload pipeline, private preview, failure retry, atomic publish and revision history", async () => {
  ctx.engine.failNextIngest = true;
  const uploaded = await request("/documents", adminCookie, "POST", {
    filename: "release.md",
    title: "回归专用资料",
    version: "V2",
    visibility: "team",
    data: Buffer.from(
      "# 回归流程\n\nRELEASE_CHECK 校验：发布前需要双人核对。",
    ).toString("base64"),
  });
  assert.equal(uploaded.status, 201);
  await until(
    () => request("/jobs"),
    (r) =>
      r.body.some(
        (j: any) => j.id === uploaded.body.jobId && j.status === "failed",
      ),
  );
  const badPublish = await request("/releases", adminCookie, "POST", {
    ids: [uploaded.body.id],
    label: "不应发布",
  });
  assert.equal(badPublish.status, 409);
  assert.equal(
    (await request(`/jobs/${uploaded.body.jobId}/retry`, adminCookie, "POST"))
      .status,
    200,
  );
  await until(
    () => request("/jobs"),
    (r) =>
      r.body.some(
        (j: any) => j.id === uploaded.body.jobId && j.status === "ready",
      ),
  );
  const before = await makeRun("RELEASE_CHECK 怎么校验？");
  assert.equal((await finished(before.body.id)).refs.length, 0);
  const document = (await request(`/documents/${uploaded.body.id}`)).body;
  assert.equal(document.chunks.length, 1);
  const release = await request("/releases", adminCookie, "POST", {
    ids: [uploaded.body.id],
    label: "测试发布",
  });
  assert.equal(release.status, 201);
  const after = await makeRun("RELEASE_CHECK 怎么校验？");
  const answer = await finished(after.body.id);
  assert.match(answer.answer, /双人核对/);
  const revision = await request("/documents", adminCookie, "POST", {
    filename: "release.md",
    title: "回归专用资料",
    version: "V2",
    visibility: "team",
    familyId: document.family_id,
    data: Buffer.from(
      "# 回归流程\n\nRELEASE_CHECK 校验：改为三人核对。",
    ).toString("base64"),
  });
  await until(
    () => request(`/documents/${revision.body.id}`),
    (r) => r.body.status === "ready",
  );
  assert.equal(
    (await request(`/documents/${revision.body.id}`)).body.revision,
    2,
  );
  assert.match(
    (await request(`/runs/${answer.id}/sources/S1`, memberCookie)).body.text,
    /双人核对/,
  );
  assert.equal(
    (
      await request("/releases", adminCookie, "POST", {
        ids: [uploaded.body.id, revision.body.id],
        label: "混合修订",
      })
    ).status,
    409,
  );
  await request(`/releases/${originalRelease}/activate`, adminCookie, "POST");
});
test("revocation blocks historical answers and stops active work, not just document lists", async () => {
  const r = await makeRun("成员导入限制是多少？");
  const done = await finished(r.body.id);
  const docId = done.refs[0].documentId;
  const running = await makeRun("成员导入限制、格式和管理员角色是什么？");
  await until(
    () => request(`/runs/${running.body.id}`, memberCookie),
    (r) => r.body.status === "generating",
  );
  await request(`/documents/${docId}/visibility`, adminCookie, "PATCH", {
    visibility: "ops",
  });
  assert.equal((await request(`/runs/${done.id}`, memberCookie)).status, 403);
  assert.equal(
    (await request(`/runs/${done.id}/sources/S1`, memberCookie)).status,
    403,
  );
  const state = (
    await ctx.db.query<{ status: string }>(
      "SELECT status FROM runs WHERE id=$1",
      [running.body.id],
    )
  ).rows[0];
  assert.equal(state.status, "failed");
  await request(`/documents/${docId}/visibility`, adminCookie, "PATCH", {
    visibility: "team",
  });
});
test("feedback, versioned test sets, persisted A/B execution and manual review", async () => {
  const answer = await makeRun("IMPORT_EMAIL_DUPLICATE 怎么处理？");
  await finished(answer.body.id);
  assert.equal(
    (
      await request(`/runs/${answer.body.id}/feedback`, memberCookie, "POST", {
        useful: false,
        reason: "纳入回归题",
      })
    ).status,
    200,
  );
  assert.ok(
    (await request("/feedback")).body.some(
      (f: any) => f.run_id === answer.body.id,
    ),
  );
  const datasets = (await request("/datasets")).body;
  assert.equal(datasets[0].cases.length, 8);
  const next = await request("/datasets", adminCookie, "POST", {
    name: datasets[0].name,
    cases: datasets[0].cases,
  });
  assert.equal(next.body.version, 2);
  const evaluation = await request("/evaluations", adminCookie, "POST", {
    datasetId: datasets[0].id,
  });
  const list = await until(
    () => request("/evaluations"),
    (r) =>
      r.body.find((j: any) => j.id === evaluation.body.id)?.status ===
      "completed",
    30000,
  );
  const job = list.body.find((j: any) => j.id === evaluation.body.id);
  assert.equal(job.results.length, 16);
  assert.ok(job.results.every((r: any) => r.provider === "extractive-demo"));
  assert.equal(job.planned, 16);
  assert.ok(job.results.every((r: any) => r.status === "completed"));
  assert.ok(
    job.results
      .filter((r: any) => r.caseId === "private-denied")
      .every((r: any) => r.refused),
  );
  const item = job.results[0];
  assert.equal(
    (
      await request(`/evaluations/${job.id}/review`, adminCookie, "POST", {
        caseId: item.caseId,
        config: item.config,
        supported: true,
        note: "逐项核对原文",
      })
    ).status,
    200,
  );
});
