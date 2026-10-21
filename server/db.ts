import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";

export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function passwordHash(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString("hex");
}
export function verifyPassword(
  password: string,
  salt: string,
  expected: string,
) {
  const a = Buffer.from(passwordHash(password, salt), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function createDb(path?: string) {
  const db = new PGlite({ dataDir: path, extensions: { vector } });
  await db.waitReady;
  await db.exec(`CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL,workspace_id TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,family_id TEXT NOT NULL,revision INT NOT NULL,title TEXT NOT NULL,product_version TEXT NOT NULL,visibility TEXT NOT NULL,workspace_id TEXT NOT NULL,filename TEXT NOT NULL,raw_base64 TEXT NOT NULL,text_content TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'queued',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(family_id,revision));
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,doc_id TEXT REFERENCES documents(id),status TEXT NOT NULL,attempts INT NOT NULL DEFAULT 1,error TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY,doc_id TEXT REFERENCES documents(id),ordinal INT NOT NULL,text_content TEXT NOT NULL,page INT,paragraph INT NOT NULL,embedding vector,index_key TEXT NOT NULL,UNIQUE(doc_id,ordinal,index_key));
CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,label TEXT NOT NULL,doc_ids JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),conversation_id TEXT NOT NULL,question TEXT NOT NULL,product_version TEXT NOT NULL,config TEXT NOT NULL,release_id TEXT REFERENCES releases(id),provider TEXT NOT NULL,status TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',refs JSONB NOT NULL DEFAULT '[]',trace JSONB NOT NULL DEFAULT '{}',error TEXT,usage JSONB,next_seq INT NOT NULL DEFAULT 0,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(owner_id,idempotency_key));
CREATE TABLE IF NOT EXISTS events(run_id TEXT REFERENCES runs(id),sequence INT NOT NULL,type TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(run_id,sequence));
CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,run_id TEXT REFERENCES runs(id),user_id TEXT REFERENCES users(id),useful BOOLEAN NOT NULL,reason TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(run_id,user_id));
CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY,name TEXT NOT NULL,version INT NOT NULL,cases JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS eval_jobs(id TEXT PRIMARY KEY,dataset_id TEXT REFERENCES datasets(id),release_id TEXT REFERENCES releases(id),owner_id TEXT REFERENCES users(id),provider TEXT NOT NULL,status TEXT NOT NULL,results JSONB NOT NULL DEFAULT '[]',error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS events_run ON events(run_id,sequence);
CREATE INDEX IF NOT EXISTS chunks_scope ON chunks(doc_id,index_key);`);
  for (const [id, name, email, role] of [
    ["admin", "知识运营者", "admin@example.test", "admin"],
    ["member", "支持专员", "member@example.test", "member"],
  ]) {
    const salt = randomBytes(16).toString("hex");
    await db.query(
      "INSERT INTO users VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING",
      [id, name, email, role, "demo", salt, passwordHash("DemoPass123!", salt)],
    );
  }
  return db;
}
export type DB = Awaited<ReturnType<typeof createDb>>;
