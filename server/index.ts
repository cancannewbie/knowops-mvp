import { existsSync } from "node:fs";
import { createApplication } from "./app";
if (existsSync(".env")) process.loadEnvFile(".env");
const { app, engine } = await createApplication({
  dataDir: process.env.DATA_DIR ?? "./data/knowops",
});
const port = Number(process.env.PORT) || 5413;
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `KnowOps: http://127.0.0.1:${port} · ${process.env.GENERATION_MODE ?? "extractive-demo"}`,
  ),
);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => void engine.close().then(() => process.exit(0)));
  });
