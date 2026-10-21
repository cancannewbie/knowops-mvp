import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test("admin: upload → publish → streamed answer → citation → feedback → A/B review", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByText("每个答案，都可以向前追溯。")).toBeVisible();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "知识资料", exact: false }).click();
  await page.getByRole("button", { name: "上传资料", exact: false }).click();
  const title = `浏览器验收资料 ${Date.now()}`;
  await page.getByLabel("文件", { exact: true }).setInputFiles({
    name: "browser-fixture.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# 浏览器验收\n\nQA_BROWSER_RELEASE 的校验上限为 3000。发布前执行人工核对。",
    ),
  });
  await page.getByLabel("资料名称", { exact: true }).fill(title);
  await page.getByRole("button", { name: "上传并开始处理" }).click();
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row.getByText("待发布")).toBeVisible();
  await page.getByRole("button", { name: "选择最新就绪资料" }).click();
  await page.getByRole("textbox", { name: "发布名称" }).fill("浏览器验收发布");
  await page.getByRole("button", { name: "发布清单", exact: true }).click();
  await expect(page.getByText("知识发布已切换")).toBeVisible();
  await page.getByRole("button", { name: "问答工作台", exact: false }).click();
  await page
    .getByRole("textbox", { name: "输入问题" })
    .fill("QA_BROWSER_RELEASE 怎么校验？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.locator(".markdown")).toContainText("3000");
  await page.screenshot({
    path: "docs/screenshots/answer.png",
    fullPage: true,
  });
  await page.locator(".sources button").first().click();
  await expect(page.getByRole("dialog")).toContainText("3000");
  await expect(page.getByRole("dialog")).toContainText("资料修订 1");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "反馈问题", exact: true }).click();
  await page
    .getByPlaceholder("例如：遗漏管理员角色限制")
    .fill("浏览器回归：已核对来源");
  await page.getByRole("button", { name: "保存反馈" }).click();
  await page.getByRole("button", { name: "检索诊断", exact: false }).click();
  await page.getByLabel("选择问答运行").selectOption({
    label: (
      await page.getByLabel("选择问答运行").locator("option").allTextContents()
    ).find((t) => t.includes("QA_BROWSER_RELEASE"))!,
  });
  await expect(page.getByText("授权过滤：")).toBeVisible();
  await page.getByRole("button", { name: "质量评测", exact: false }).click();
  await page
    .getByLabel("版本化测试集")
    .selectOption({ label: "产品支持回归集 · v1 · 8 题" });
  const createdEvaluation = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/evaluations") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "运行 A/B 评测" }).click();
  const evaluationId = (await (await createdEvaluation).json()).id;
  await expect(page.getByLabel("选择评测记录")).toHaveValue(evaluationId);
  await expect(page.getByText("完成记录 16 / 16")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/evaluation.png",
    fullPage: true,
  });
  await page.locator(".result-pass").first().click();
  await page.getByLabel("人工复核说明").fill("浏览器核对原文");
  await page.getByRole("button", { name: "原文支持答案", exact: true }).click();
  await expect(page.getByText("人工复核已保存")).toBeVisible();
  await page.getByRole("button", { name: "反馈案例", exact: false }).click();
  await expect(page.getByText("浏览器回归：已核对来源").first()).toBeVisible();
  await page.getByRole("button", { name: "加入测试集" }).first().click();
  await page
    .getByLabel("预期关键词（逗号分隔）")
    .pressSequentially("3000", { delay: 20 });
  await expect(page.getByLabel("预期关键词（逗号分隔）")).toHaveValue("3000");
  await page.getByRole("button", { name: "保存回归题与新版本" }).click();
  await expect(page.getByText("反馈已加入测试集新版本")).toBeVisible();
  assertNoErrors(errors);
});
function assertNoErrors(errors: string[]) {
  expect(errors).toEqual([]);
}
test("member: restricted sources absent; old conversations never overwrite new run", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "支持专员", exact: true }).click();
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.getByRole("button", { name: "知识资料", exact: false }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "客户部署记录" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传资料" })).toHaveCount(0);
  await page.getByRole("button", { name: "问答工作台", exact: false }).click();
  await page
    .getByRole("textbox", { name: "输入问题" })
    .fill("客户部署有什么特殊配置？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.locator(".markdown")).toContainText("资料不足");
  await expect(page.locator(".messages")).not.toContainText("ops-only-secret");
  await page.getByRole("button", { name: "新建会话", exact: false }).click();
  await expect(page.locator(".messages")).not.toContainText("资料不足");
  await page
    .getByRole("textbox", { name: "输入问题" })
    .fill("IMPORT_EMAIL_DUPLICATE 怎么处理？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.locator(".markdown")).toContainText("删除重复行");
  await page.screenshot({
    path: "docs/screenshots/business-answer.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .locator(".conversation-list")
    .getByRole("button", { name: /IMPORT_EMAIL_DUPLICATE 怎么处理/ })
    .first()
    .click();
  await expect(page.locator(".markdown")).toContainText("删除重复行");
});
