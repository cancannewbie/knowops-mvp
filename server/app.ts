import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { z, ZodError } from "zod";
import { createDb, hash, verifyPassword } from "./db";
import { Engine } from "./engine";
import { AppError, allowed } from "./knowledge";
import { providerMode } from "./provider";
import type { User, Run } from "../shared/contracts";
import { terminal } from "../shared/contracts";

type AuthRequest = Request & { user: User; requestId: string };
const asyncRoute =
  (fn: (req: AuthRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthRequest, res)).catch(next);
  };
const bodyText = z.string().trim().min(1).max(5000);
export async function createApplication(
  options: { dataDir?: string; seed?: boolean } = {},
) {
  const db = await createDb(options.dataDir);
  const engine = new Engine(db);
  await engine.initialize(options.seed !== false);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    (req as AuthRequest).requestId = randomUUID();
    res.setHeader("X-Request-Id", (req as AuthRequest).requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    if (
      ["POST", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin
    ) {
      try {
        if (
          new URL(req.headers.origin).host !== req.headers.host &&
          !(
            req.headers.host?.startsWith("127.0.0.1:5413") &&
            new URL(req.headers.origin).host === "127.0.0.1:5173"
          )
        )
          throw new Error();
      } catch {
        return next(new AppError(403, "ORIGIN_FORBIDDEN", "请求来源不受信任"));
      }
    }
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  const sessionToken = (req: Request) =>
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("knowops_session="))
      ?.split("=")[1];
  const loginAttempts = new Map<string, { count: number; until: number }>();
  app.post(
    "/api/login",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          email: z.string().email(),
          password: z.string().min(1).max(200),
        })
        .parse(req.body);
      const address = req.ip ?? "local";
      let attempt = loginAttempts.get(address);
      if (!attempt || attempt.until < Date.now()) {
        attempt = { count: 0, until: Date.now() + 60000 };
        loginAttempts.set(address, attempt);
      }
      if (++attempt.count > 20)
        throw new AppError(
          429,
          "LOGIN_RATE_LIMIT",
          "登录尝试过多，请一分钟后再试",
        );
      const user = (
        await db.query<any>("SELECT * FROM users WHERE email=$1", [input.email])
      ).rows[0];
      if (
        !user ||
        !verifyPassword(input.password, user.salt, user.password_hash)
      )
        throw new AppError(401, "INVALID_LOGIN", "邮箱或密码错误");
      const token = randomBytes(32).toString("hex");
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '24 hours')",
        [hash(token), user.id],
      );
      res.cookie("knowops_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.COOKIE_SECURE === "true",
        maxAge: 86400000,
        path: "/",
      });
      res.json({ user: await engine.user(user.id) });
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, name: "KnowOps" }),
  );
  app.use("/api", (req, res, next) => {
    void (async () => {
      const token = sessionToken(req);
      if (!token) throw new AppError(401, "SESSION_REQUIRED", "请先登录");
      const session = (
        await db.query<{ user_id: string }>(
          "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()",
          [hash(token)],
        )
      ).rows[0];
      if (!session)
        throw new AppError(401, "SESSION_EXPIRED", "会话已过期，请重新登录");
      (req as AuthRequest).user = await engine.user(session.user_id);
      next();
    })().catch(next);
  });
  const admin = (req: AuthRequest) => {
    if (req.user.role !== "admin")
      throw new AppError(403, "FORBIDDEN", "此操作需要知识运营者权限");
  };
  const runDto = (user: User, run: Run) => ({
    ...run,
    trace: user.role === "admin" ? run.trace : {},
  });
  const getDoc = async (user: User, id: string) => {
    const doc = (
      await db.query<any>("SELECT * FROM documents WHERE id=$1", [id])
    ).rows[0];
    if (!doc || !allowed(user, doc))
      throw new AppError(404, "DOCUMENT_NOT_FOUND", "资料不存在或已无访问权限");
    return doc;
  };
  app.post(
    "/api/logout",
    asyncRoute(async (req, res) => {
      const token = sessionToken(req);
      if (token)
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          hash(token),
        ]);
      res.clearCookie("knowops_session", { path: "/" });
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/me",
    asyncRoute(async (req, res) =>
      res.json({
        user: req.user,
        provider: providerMode(),
        embedding: process.env.EMBEDDING_API_BASE
          ? "真实 Embedding（需配置完整）"
          : "本地特征向量演示",
        releaseId: await engine.currentRelease(),
      }),
    ),
  );
  app.get(
    "/api/documents",
    asyncRoute(async (req, res) => {
      const docs = (
        await db.query<any>(
          "SELECT d.id,d.family_id,d.revision,d.title,d.product_version,d.visibility,d.status,d.filename,d.created_at,(SELECT count(*)::int FROM chunks WHERE doc_id=d.id) AS chunk_count FROM documents d WHERE workspace_id=$1 AND (visibility='team' OR $2='admin') ORDER BY created_at DESC",
          [req.user.workspace_id, req.user.role],
        )
      ).rows;
      res.json(docs);
    }),
  );
  app.post(
    "/api/documents",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          filename: z.string().min(1).max(200),
          data: z.string().min(1).max(7500000),
          title: z.string().trim().min(1).max(150),
          version: z.enum(["V1", "V2", "V3", "*"]),
          visibility: z.enum(["team", "ops"]),
          familyId: z.string().optional(),
        })
        .parse(req.body);
      res.status(201).json(await engine.upload(req.user, input));
    }),
  );
  app.get(
    "/api/documents/:id",
    asyncRoute(async (req, res) => {
      const doc = await getDoc(req.user, String(req.params.id));
      delete doc.raw_base64;
      doc.chunks = (
        await db.query(
          "SELECT id,ordinal,text_content,page,paragraph,index_key FROM chunks WHERE doc_id=$1 ORDER BY ordinal",
          [doc.id],
        )
      ).rows;
      res.json(doc);
    }),
  );
  app.get(
    "/api/documents/:id/file",
    asyncRoute(async (req, res) => {
      const doc = await getDoc(req.user, String(req.params.id));
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      );
      res
        .type(
          doc.filename.endsWith(".pdf")
            ? "application/pdf"
            : "text/plain; charset=utf-8",
        )
        .send(Buffer.from(doc.raw_base64, "base64"));
    }),
  );
  app.patch(
    "/api/documents/:id/visibility",
    asyncRoute(async (req, res) => {
      const { visibility } = z
        .object({ visibility: z.enum(["team", "ops"]) })
        .parse(req.body);
      await engine.setVisibility(req.user, String(req.params.id), visibility);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/jobs",
    asyncRoute(async (req, res) => {
      admin(req);
      res.json(
        (
          await db.query(
            "SELECT j.*,d.title,d.filename FROM jobs j JOIN documents d ON d.id=j.doc_id WHERE d.workspace_id=$1 ORDER BY j.updated_at DESC",
            [req.user.workspace_id],
          )
        ).rows,
      );
    }),
  );
  app.post(
    "/api/jobs/:id/:action",
    asyncRoute(async (req, res) => {
      admin(req);
      const job = (
        await db.query<any>(
          "SELECT j.*,d.workspace_id,d.visibility FROM jobs j JOIN documents d ON d.id=j.doc_id WHERE j.id=$1",
          [String(req.params.id)],
        )
      ).rows[0];
      if (!job || !allowed(req.user, job))
        throw new AppError(404, "JOB_NOT_FOUND", "任务不存在");
      if (req.params.action === "retry") {
        await db.transaction(async (tx) => {
          const current = (
            await tx.query<{ status: string }>(
              "SELECT status FROM jobs WHERE id=$1 FOR UPDATE",
              [job.id],
            )
          ).rows[0];
          if (!["failed", "cancelled"].includes(current.status))
            throw new AppError(409, "JOB_STATE", "仅失败或取消的任务可以重试");
          await tx.query(
            "UPDATE jobs SET status='queued',error=NULL,attempts=attempts+1,updated_at=now() WHERE id=$1",
            [job.id],
          );
          await tx.query("UPDATE documents SET status='queued' WHERE id=$1", [
            job.doc_id,
          ]);
        });
        void engine.tick();
      } else if (req.params.action === "cancel") {
        await db.transaction(async (tx) => {
          const current = (
            await tx.query<{ status: string }>(
              "SELECT status FROM jobs WHERE id=$1 FOR UPDATE",
              [job.id],
            )
          ).rows[0];
          if (current.status === "ready")
            throw new AppError(409, "JOB_STATE", "已完成任务无法取消");
          await tx.query(
            "UPDATE jobs SET status='cancelled',updated_at=now() WHERE id=$1",
            [job.id],
          );
          await tx.query(
            "UPDATE documents SET status='cancelled' WHERE id=$1",
            [job.doc_id],
          );
        });
      } else throw new AppError(404, "ACTION_UNKNOWN", "未知任务操作");
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/releases",
    asyncRoute(async (req, res) => {
      const releases = (
        await db.query<any>("SELECT * FROM releases ORDER BY created_at DESC")
      ).rows;
      const visibleIds = (
        await db.query<{ id: string }>(
          "SELECT id FROM documents WHERE workspace_id=$1 AND (visibility='team' OR $2='admin')",
          [req.user.workspace_id, req.user.role],
        )
      ).rows.map((d) => d.id);
      res.json({
        current: await engine.currentRelease(),
        items: releases.map((r) => ({
          ...r,
          doc_ids: r.doc_ids.filter((id: string) => visibleIds.includes(id)),
        })),
      });
    }),
  );
  app.post(
    "/api/releases",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          ids: z.array(z.string()).min(1).max(100),
          label: z.string().trim().min(1).max(100),
        })
        .parse(req.body);
      res
        .status(201)
        .json(await engine.publish(req.user, input.ids, input.label));
    }),
  );
  app.post(
    "/api/releases/:id/activate",
    asyncRoute(async (req, res) => {
      admin(req);
      const release = (
        await db.query<any>("SELECT * FROM releases WHERE id=$1", [
          String(req.params.id),
        ])
      ).rows[0];
      if (!release)
        throw new AppError(404, "RELEASE_NOT_FOUND", "发布版本不存在");
      for (const id of release.doc_ids) await getDoc(req.user, id);
      await db.query(
        "UPDATE settings SET value=$1 WHERE key='current_release'",
        [JSON.stringify(release.id)],
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/runs",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          question: bodyText,
          version: z.enum(["V1", "V2", "V3"]),
          config: z.enum(["A", "B"]),
          conversationId: z.string().min(1).max(100),
          idempotencyKey: z.string().min(8).max(150),
        })
        .parse(req.body);
      const run = await engine.createRun(req.user, input);
      res
        .status(201)
        .json(runDto(req.user, await engine.getRun(req.user, run.id)));
    }),
  );
  app.get(
    "/api/runs",
    asyncRoute(async (req, res) => {
      const runs = (
        await db.query<Run>(
          "SELECT * FROM runs WHERE owner_id=$1 AND conversation_id NOT LIKE 'evaluation:%' ORDER BY created_at DESC LIMIT 100",
          [req.user.id],
        )
      ).rows;
      const visible = [];
      for (const run of runs)
        if (await engine.accessible(req.user, run))
          visible.push({
            ...run,
            trace: req.user.role === "admin" ? run.trace : {},
          });
      res.json(visible);
    }),
  );
  app.get(
    "/api/runs/:id",
    asyncRoute(async (req, res) => {
      const run = await engine.getRun(req.user, String(req.params.id));
      res.json({ ...run, trace: req.user.role === "admin" ? run.trace : {} });
    }),
  );
  app.post(
    "/api/runs/:id/cancel",
    asyncRoute(async (req, res) => {
      res.json(
        runDto(
          req.user,
          await engine.cancelRun(req.user, String(req.params.id)),
        ),
      );
    }),
  );
  app.get(
    "/api/runs/:id/trace",
    asyncRoute(async (req, res) => {
      admin(req);
      res.json((await engine.getRun(req.user, String(req.params.id))).trace);
    }),
  );
  app.get(
    "/api/runs/:id/sources/:source",
    asyncRoute(async (req, res) => {
      const run = await engine.getRun(req.user, String(req.params.id));
      const source = run.refs.find((r) => r.id === req.params.source);
      if (!source)
        throw new AppError(404, "SOURCE_NOT_FOUND", "引用不属于本次回答");
      await getDoc(req.user, source.documentId);
      res.json({
        ...source,
        runId: run.id,
        releaseId: run.release_id,
        mapping: "来源已匹配，内容支持度尚需人工复核",
      });
    }),
  );
  app.get(
    "/api/runs/:id/events",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id);
      await engine.getRun(req.user, id);
      let cursor = z.coerce
        .number()
        .int()
        .min(0)
        .parse(req.query.after ?? 0);
      let closed = false;
      let busy = false;
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      let timer: ReturnType<typeof setInterval>;
      const pump = async () => {
        if (closed || busy) return;
        busy = true;
        try {
          const token = sessionToken(req);
          const session = (
            await db.query(
              "SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now()",
              [hash(token ?? "")],
            )
          ).rows.length;
          if (!session) throw new AppError(401, "SESSION_EXPIRED", "会话过期");
          const run = await engine.getRun(req.user, id);
          const events = (
            await db.query<{ sequence: number; type: string; payload: any }>(
              "SELECT sequence,type,payload FROM events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence",
              [id, cursor],
            )
          ).rows;
          for (const event of events) {
            if (closed) break;
            res.write(
              `id: ${event.sequence}\ndata: ${JSON.stringify({ runId: id, ...event })}\n\n`,
            );
            cursor = event.sequence;
          }
          if (terminal(run.status)) {
            closed = true;
            clearInterval(timer);
            res.end();
          } else if (!events.length) res.write(": heartbeat\n\n");
        } catch (error) {
          if (!closed) {
            res.write(
              `event: transport-error\ndata: ${JSON.stringify({ transportError: { message: error instanceof Error ? error.message : "连接失败", code: error instanceof AppError ? error.code : "STREAM_ERROR" } })}\n\n`,
            );
            res.end();
          }
          closed = true;
          clearInterval(timer);
        } finally {
          busy = false;
        }
      };
      timer = setInterval(() => void pump(), 120);
      res.on("close", () => {
        closed = true;
        clearInterval(timer);
      });
      await pump();
    }),
  );
  app.post(
    "/api/runs/:id/feedback",
    asyncRoute(async (req, res) => {
      const run = await engine.getRun(req.user, String(req.params.id));
      const input = z
        .object({ useful: z.boolean(), reason: z.string().trim().max(1000) })
        .parse(req.body);
      await db.query(
        "INSERT INTO feedback VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(run_id,user_id) DO UPDATE SET useful=excluded.useful,reason=excluded.reason",
        [randomUUID(), run.id, req.user.id, input.useful, input.reason],
      );
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/feedback",
    asyncRoute(async (req, res) => {
      admin(req);
      const entries = (
        await db.query<any>(
          "SELECT f.*,r.question,r.product_version FROM feedback f JOIN runs r ON r.id=f.run_id ORDER BY f.created_at DESC",
        )
      ).rows;
      const visible = [];
      for (const entry of entries) {
        try {
          await engine.getRun(req.user, entry.run_id);
          visible.push(entry);
        } catch {}
      }
      res.json(visible);
    }),
  );
  const caseSchema = z.object({
    id: z.string().min(1).max(60),
    question: bodyText,
    version: z.enum(["V1", "V2", "V3"]),
    as: z.enum(["admin", "member"]),
    expected: z.array(z.string().min(1).max(100)).max(20),
    refuse: z.boolean(),
  });
  app.get(
    "/api/datasets",
    asyncRoute(async (req, res) => {
      admin(req);
      res.json(
        (await db.query("SELECT * FROM datasets ORDER BY created_at DESC"))
          .rows,
      );
    }),
  );
  app.post(
    "/api/datasets",
    asyncRoute(async (req, res) => {
      admin(req);
      const input = z
        .object({
          name: z.string().trim().min(1).max(100),
          cases: z.array(caseSchema).min(1).max(60),
        })
        .parse(req.body);
      if (new Set(input.cases.map((c) => c.id)).size !== input.cases.length)
        throw new AppError(400, "DUPLICATE_CASE", "题目标识重复");
      const id = randomUUID();
      const version = await db.transaction(async (tx) => {
        const version = (
          await tx.query<{ version: number }>(
            "SELECT COALESCE(MAX(version),0)+1 AS version FROM datasets WHERE name=$1",
            [input.name],
          )
        ).rows[0].version;
        await tx.query("INSERT INTO datasets VALUES($1,$2,$3,$4,now())", [
          id,
          input.name,
          version,
          JSON.stringify(input.cases),
        ]);
        return version;
      });
      res.status(201).json({ id, version });
    }),
  );
  app.get(
    "/api/evaluations",
    asyncRoute(async (req, res) => {
      admin(req);
      res.json(
        (
          await db.query<any>(
            "SELECT e.*,d.name,d.version,jsonb_array_length(d.cases)*2 AS planned FROM eval_jobs e JOIN datasets d ON d.id=e.dataset_id ORDER BY e.created_at DESC",
          )
        ).rows,
      );
    }),
  );
  app.post(
    "/api/evaluations",
    asyncRoute(async (req, res) => {
      admin(req);
      const input = z.object({ datasetId: z.string() }).parse(req.body);
      if (
        !(
          await db.query("SELECT id FROM datasets WHERE id=$1", [
            input.datasetId,
          ])
        ).rows.length
      )
        throw new AppError(404, "DATASET_NOT_FOUND", "测试集不存在");
      const release = await engine.currentRelease();
      if (!release) throw new AppError(409, "NO_RELEASE", "请先发布知识资料");
      const id = randomUUID();
      await db.query(
        "INSERT INTO eval_jobs(id,dataset_id,release_id,owner_id,provider,status) VALUES($1,$2,$3,$4,$5,'queued')",
        [id, input.datasetId, release, req.user.id, providerMode()],
      );
      void engine.tick();
      res.status(201).json({ id });
    }),
  );
  app.post(
    "/api/evaluations/:id/cancel",
    asyncRoute(async (req, res) => {
      admin(req);
      const id = String(req.params.id);
      await db.query(
        "UPDATE eval_jobs SET status='cancelled' WHERE id=$1 AND status IN ('queued','running')",
        [id],
      );
      const runs = (
        await db.query<Run>(
          "SELECT * FROM runs WHERE conversation_id=$1 AND status NOT IN ('completed','failed','cancelled')",
          [`evaluation:${id}`],
        )
      ).rows;
      for (const run of runs) await engine.cancelRun(req.user, run.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/evaluations/:id/review",
    asyncRoute(async (req, res) => {
      admin(req);
      const input = z
        .object({
          caseId: z.string(),
          config: z.enum(["A", "B"]),
          supported: z.boolean(),
          note: z.string().trim().max(500),
        })
        .parse(req.body);
      const id = String(req.params.id);
      await db.transaction(async (tx) => {
        const job = (
          await tx.query<any>(
            "SELECT * FROM eval_jobs WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!job) throw new AppError(404, "EVALUATION_NOT_FOUND", "评测不存在");
        if (!terminal(job.status))
          throw new AppError(
            409,
            "EVALUATION_RUNNING",
            "请等待评测结束再人工复核",
          );
        const item = job.results.find(
          (r: any) => r.caseId === input.caseId && r.config === input.config,
        );
        if (!item)
          throw new AppError(404, "RESULT_NOT_FOUND", "评测结果不存在");
        item.review = {
          supported: input.supported,
          note: input.note,
          by: req.user.name,
          at: new Date().toISOString(),
        };
        await tx.query("UPDATE eval_jobs SET results=$2 WHERE id=$1", [
          id,
          JSON.stringify(job.results),
        ]);
      });
      res.json({ ok: true });
    }),
  );
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "NOT_FOUND", "接口不存在")),
  );
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  app.use(
    (error: unknown, req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) return;
      const e =
        error instanceof AppError
          ? error
          : error instanceof ZodError
            ? new AppError(
                400,
                "VALIDATION_ERROR",
                error.issues
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("；"),
              )
            : error instanceof SyntaxError
              ? new AppError(400, "INVALID_JSON", "请求 JSON 格式不正确")
              : (error as { status?: number })?.status === 413
                ? new AppError(413, "PAYLOAD_TOO_LARGE", "请求体超过大小限制")
                : new AppError(500, "INTERNAL_ERROR", "处理失败，请稍后重试");
      if (e.status === 500)
        console.error("request failed", (req as AuthRequest).requestId);
      res.status(e.status).json({
        code: e.code,
        message: e.message,
        requestId: (req as AuthRequest).requestId,
      });
    },
  );
  return { app, engine, db };
}
