import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createDb } from "../server/db";
import { Engine } from "../server/engine";
import { until } from "./support";

test("disk restart resumes interrupted ingestion, retains completed artifacts and marks answer interruption", async () => {
  const parent = path.resolve("data/test-restart");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "case-"));
  let engine: Engine | undefined;
  try {
    let db = await createDb(directory);
    engine = new Engine(db);
    const admin = await engine.user("admin");
    const uploaded = await engine.upload(admin, {
      filename: "restart.txt",
      title: "重启恢复资料",
      version: "V2",
      visibility: "team",
      data: Buffer.from("RESTART_CHECK 资料在重启后完成处理。").toString(
        "base64",
      ),
    });
    await db.query("UPDATE jobs SET status='indexing' WHERE id=$1", [
      uploaded.jobId,
    ]);
    await db.query(
      "INSERT INTO releases(id,label,doc_ids) VALUES('restart-release','测试','[]')",
    );
    const run = await engine.createRun(
      admin,
      {
        question: "重启测试",
        version: "V2",
        config: "B",
        conversationId: "restart",
        idempotencyKey: "restart-test-key",
        releaseId: "restart-release",
      },
      false,
    );
    await engine.event(
      run.id,
      "delta",
      { text: "已收到的部分回答" },
      "generating",
    );
    await engine.close();
    db = await createDb(directory);
    engine = new Engine(db);
    await engine.initialize(false);
    await until(
      async () => {
        return (
          await db.query<{ status: string }>(
            "SELECT status FROM jobs WHERE id=$1",
            [uploaded.jobId],
          )
        ).rows[0].status;
      },
      (s) => s === "ready",
    );
    const restored = (
      await db.query<any>("SELECT * FROM runs WHERE id=$1", [run.id])
    ).rows[0];
    assert.equal(restored.status, "failed");
    assert.match(restored.answer, /部分回答/);
    assert.match(restored.error, /重启/);
    assert.equal(
      (await db.query("SELECT id FROM chunks WHERE doc_id=$1", [uploaded.id]))
        .rows.length,
      1,
    );
    await engine.close();
    engine = undefined;
    db = await createDb(directory);
    assert.equal(
      (await db.query("SELECT id FROM chunks WHERE doc_id=$1", [uploaded.id]))
        .rows.length,
      1,
    );
    await db.close();
  } finally {
    if (engine) await engine.close();
    if (path.dirname(directory) !== parent)
      throw new Error("Unsafe cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
