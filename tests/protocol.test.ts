import test from "node:test";
import assert from "node:assert/strict";
import {
  SSEDecoder,
  applyRunEvent,
  TransportError,
  type StreamState,
} from "../shared/sse";
import type { RunEvent } from "../shared/contracts";
import { parseFile, splitParts, localVector } from "../server/knowledge";
import { simplePdf } from "./support";

test("SSE: arbitrary byte boundaries preserve Chinese and multiple complete events", () => {
  const events: RunEvent[] = [
    { runId: "a", sequence: 1, type: "delta", payload: { text: "中文🔎" } },
    { runId: "a", sequence: 2, type: "delta", payload: { text: "引用" } },
    { runId: "a", sequence: 3, type: "done", payload: {} },
  ];
  const bytes = new TextEncoder().encode(
    ": heartbeat\r\n\r\n" +
      events
        .map((e) => `id: ${e.sequence}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`)
        .join(""),
  );
  for (const size of [1, 2, 3, 7, 19, 1024]) {
    const parser = new SSEDecoder();
    const actual: RunEvent[] = [];
    for (let i = 0; i < bytes.length; i += size)
      actual.push(...parser.push(bytes.slice(i, i + size)));
    assert.deepEqual(actual, events);
  }
});
test("SSE: replay dedupe, old run isolation, terminal state and sequence gaps", () => {
  let s: StreamState = { runId: "a", sequence: 0, text: "", ended: false };
  const e: RunEvent = {
    runId: "a",
    sequence: 1,
    type: "delta",
    payload: { text: "你好" },
  };
  s = applyRunEvent(s, e);
  assert.equal(applyRunEvent(s, e), s);
  assert.equal(applyRunEvent(s, { ...e, runId: "b", sequence: 2 }), s);
  assert.throws(() => applyRunEvent(s, { ...e, sequence: 3 }), /间隙/);
  s = applyRunEvent(s, { ...e, sequence: 2, type: "cancelled" });
  assert.equal(applyRunEvent(s, { ...e, sequence: 3 }), s);
  assert.equal(s.text, "你好");
});

test("SSE transport failure never consumes the next durable event sequence", () => {
  let state: StreamState = {
    runId: "recover",
    sequence: 3,
    text: "已持久化",
    ended: false,
  };
  const failedConnection = new SSEDecoder();
  assert.throws(
    () =>
      failedConnection.push(
        new TextEncoder().encode(
          'event: transport-error\ndata: {"transportError":{"code":"STREAM_ERROR","message":"temporary connection failure"}}\n\n',
        ),
      ),
    TransportError,
  );
  assert.equal(state.sequence, 3);
  assert.equal(state.ended, false);
  const resumed = new SSEDecoder();
  const [event] = resumed.push(
    new TextEncoder().encode(
      'data: {"runId":"recover","sequence":4,"type":"delta","payload":{"text":"的新内容"}}\n\n',
    ),
  );
  state = applyRunEvent(state, event);
  assert.equal(state.text, "已持久化的新内容");
  assert.equal(state.sequence, 4);
});
test("paragraph slicing keeps heading and source coordinates; local vectors are normalized features", () => {
  const chunks = splitParts([
    { text: "# Guide", page: null, paragraph: 1 },
    { text: "UTF-8 CSV 导入规则", page: null, paragraph: 2 },
  ]);
  assert.equal(chunks[0].paragraph, 2);
  assert.match(chunks[0].text, /Guide/);
  const v = localVector("UTF-8 CSV 导入规则");
  assert.equal(v.length, 48);
  assert.ok(Math.abs(v.reduce((s, n) => s + n * n, 0) - 1) < 1e-6);
});
test("simple text PDF extracts page and text; invalid and empty documents fail", async () => {
  const result = await parseFile(
    "fixture.pdf",
    simplePdf("KnowOps import limit 2000").toString("base64"),
  );
  assert.equal(result[0].page, 1);
  assert.match(result[0].text, /2000/);
  await assert.rejects(
    () => parseFile("bad.pdf", Buffer.from("not pdf").toString("base64")),
    /有效 PDF/,
  );
  await assert.rejects(
    () => parseFile("empty.txt", Buffer.from("   ").toString("base64")),
    /资料为空/,
  );
});
