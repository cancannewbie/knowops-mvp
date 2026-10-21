# 验收记录

日期：2026-10-21。环境：Windows、Node.js 22.22.2、npm、本地 PGlite、Chromium。

本文件记录开发阶段实际验证；独立验收与 GitHub 推送由项目负责人另行记录。没有提供商业模型凭据。

## 已执行命令

| 检查 | 结果 | 证据 |
|---|---|---|
| `npm install` | PASS | 安装完成，package-lock.json 已生成 |
| `npm run check` | PASS | TypeScript 无错误 |
| `npm test` | PASS | **21 / 21**，失败 0、跳过 0 |
| `npm run build` | PASS | Vite 生产构建成功 |
| `npm run test:browser` | PASS | **2 / 2** Chromium 完整流程 |
| 商业模型 / 商业 Embedding | BLOCKED | 未提供真实凭据，未产生商业调用 |
| 网站公开部署 | BLOCKED | 本任务当前交付为本地应用与源码 |
| GitHub Actions 在线运行 | BLOCKED | 本地已提供配置，远程结果另行确认 |

浏览器过程发现过两类问题并完成修复：新评测创建时短暂显示旧任务终态；弹窗重渲染抢占焦点。随后两条浏览器流程全部通过，反馈转回归题还验证了逐字符输入。

最终浏览器复验使用独立端口 **5513**、单次脚本生成的 `data/browser-suites/run-MwxOzo` 文件数据库，**2 / 2 通过（29.1 秒）**。Playwright 明确禁止复用已有服务，脚本禁止使用默认演示端口 5413，并清空商业模型 / Embedding 配置；没有操作正在运行的 5413 演示服务或其数据。每次再次执行都会生成新的 `run-*` 目录；同一轮主进程、服务和 worker 使用同一份环境配置。

## K01–K12 最小范围

| 条目 | 结果 | 实际证据 |
|---|---|---|
| K01 会话与空间/资料授权 | PASS | integration：无会话 401、伪造角色头无效、成员无运维资料；浏览器成员用例 |
| K02 上传、PDF、处理阶段 | PASS | integration 上传与重试；protocol 简单文本 PDF 实际解析、无效文件与空文本失败 |
| K03 持久队列与重启恢复 | PASS | persistence 使用文件数据库关闭/重开，恢复索引任务，保留片段，标记中断回答 |
| K04 修订、预览、发布 | PASS | integration 检查未发布不可检索、同家族双修订拒绝、历史引用仍指向 r1 |
| K05 授权检索与向量 | PASS | 真 pgvector 查询；R06 超过 30 条候选的错误码回归；受控 HTTP Embedding 与配置键隔离 |
| K06 生成适配与明确演示 | PASS | provider：正常中文 SSE、stop、无完成标记、length、content_filter、tool_calls、429 和取消；非商业模型效果验证 |
| K07 幂等、事件持久化、回放 | PASS | integration 并发同键、完整事件与正文一致、游标回放；protocol 任意 UTF-8 分块 |
| K08 取消与重新生成 | PASS | 服务端取消终态不再追加；浏览器支持重生成新运行；SSE 规则隔离不同 run |
| K09 版本化引用 | PASS | API 来源对应修订/段落；非法 S999 拒绝；浏览器打开原文引用 |
| K10 调试与授权 | PASS | 普通成员所有 run DTO 清空 trace，专用 trace 拒绝；浏览器运营诊断 |
| K11 反馈、测试集与 A/B | PASS | 8 题 × 2 配置实际运行、16 个结果；版本保存、人工复核和反馈转新测试集 |
| K12 中文可操作界面 | PASS | Chromium 操作导航、上传、发布、问答、引用、反馈、诊断、评测、复核和历史恢复；截图见下 |

## Root 预审 R02–R08 回归证据

| 问题 | 结果 | 回归方法与边界 |
|---|---|---|
| R02 通过创建/幂等/取消绕过 trace 接口 | PASS | integration 验证创建、幂等回读、取消、列表、详情 trace 为空，专用接口 403 |
| R03 检索中撤权仍把旧证据发给模型 | PASS | boundaries 用受控 HTTP 上游暂停 Embedding；撤权后生成调用数 0；恢复权限后正向对照调用数 1 并成功。另测历史答案和来源 403 |
| R04 任务状态竞争与旧尝试覆盖 | PASS | boundaries 暂停首次入库向量请求，API 取消后立即重试；放行旧结果，最终 attempt=2、job/doc 均 ready、仅一份片段；完成后取消 409 |
| R05 并发幂等键异内容误返 500 | PASS | integration 并发同键同内容同一个 run；异内容为 201 + 409 |
| R06 向量候选截断漏词法命中 | PASS | integration 构造 35 条向量分数更高的无关候选和一个低向量错误码片段；B 仍命中目标 |
| R07 把非正常 finish_reason 当成功 | PASS | provider 正常 stop、缺完成、length、content_filter、tool_calls、429、上游取消；保留增量但拒绝完整成功 |
| R08 连接错误冒充业务序号 | PASS | integration 注入事件读取故障，服务器仅发 transport-error、无 sequence、账本不增；重连从真实 sequence 1 回放。protocol 确认下一条业务序号仍可使用 |

## 浏览器实际步骤与截图

`tests/browser/workflow.spec.ts`：

1. 管理者登录、上传 Markdown、等待处理、发布。
2. 提问新资料，等待服务端已完成，打开修订引用。
3. 保存反馈，查看检索候选与上下文。
4. 新建 A/B 评测，等待对应新任务的 16 条结果，保存人工复核。
5. 反馈转新测试集，实际逐字符输入预期关键词并保存。
6. 成员无法看到运维资料，受限问题拒答；创建另一会话，刷新后恢复原回答。

- [概览截图](screenshots/overview.png)
- [业务问答截图](screenshots/business-answer.png)
- [上传验收问答截图](screenshots/answer.png)
- [评测截图](screenshots/evaluation.png)

截图是实际渲染结果，不是设计图。数据均为虚构，显示的规则分数不能推广为真实模型准确率。

## 仍未证明的事情

不以这些本地测试声称生产级吞吐、多实例正确性、商业模型语义质量、真实供应商费用或公开部署成功。完整限制见 [SCOPE](SCOPE.md)。
