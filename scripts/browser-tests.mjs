import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const port = Number(process.env.KNOWOPS_TEST_PORT || 5513);
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 5413) {
  throw new Error(
    "KNOWOPS_TEST_PORT 必须是有效独立端口，不能使用演示服务端口 5413",
  );
}

// Generate one shared directory per suite, before Playwright creates any workers.
const parent = path.join(projectRoot, "data", "browser-suites");
await mkdir(parent, { recursive: true });
const dataDir = await mkdtemp(path.join(parent, "run-"));
console.log(`Browser suite: http://127.0.0.1:${port}; data: ${dataDir}`);
const child = spawn(
  process.execPath,
  [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      KNOWOPS_TEST_PORT: String(port),
      KNOWOPS_TEST_DATA_DIR: dataDir,
      GENERATION_MODE: "extractive-demo",
      MODEL_API_BASE: "",
      MODEL_API_KEY: "",
      MODEL_NAME: "",
      EMBEDDING_API_BASE: "",
      EMBEDDING_API_KEY: "",
      EMBEDDING_MODEL: "",
      EMBEDDING_DIMENSIONS: "",
    },
  },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
