import { defineConfig } from "@playwright/test";

const port = process.env.KNOWOPS_TEST_PORT;
const dataDir = process.env.KNOWOPS_TEST_DATA_DIR;
if (!port || !dataDir) {
  throw new Error("请使用 npm run test:browser，以生成独立端口和数据目录配置");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/browser",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 1100 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm start",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 90000,
    env: { DATA_DIR: dataDir, PORT: port },
  },
});
