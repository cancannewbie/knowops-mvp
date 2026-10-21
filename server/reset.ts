import { rm } from "node:fs/promises";
import path from "node:path";
const target = path.resolve("data/knowops");
const expected = path.join(process.cwd(), "data", "knowops");
if (target !== expected || !process.argv.includes("--confirm")) {
  console.log(
    "先停止服务，再运行 npm run reset -- --confirm。仅删除本仓库 data/knowops 演示数据库。",
  );
  process.exit(1);
}
await rm(target, { recursive: true, force: true });
console.log("本仓库默认演示数据库已重置。下次启动会重新创建。");
