# de_ai_worker 原子级 Todo Round 17

更新时间：`2026-04-17`

## 本轮目标

1. 把终稿最后一步改成“AI 仅输出 Markdown 标记计划 + 脚本安全回填”。
2. 允许 AI 在合适时使用全部 Markdown 符号，而不是只限少数几种。
3. 确保最后一步不改正文词句，只能加 Markdown 语法字符、必要换行和围栏。
4. 完成真实链路验收；若仍有明确提升空间，再进入 Round 18。

## 当前进度

- [x] 建立本轮中文 Todo
- [x] 设计 Markdown 标记计划 schema
- [x] 实现脚本级安全回填与内容保真校验
- [x] 接入终稿末步 `final.markup_plan` / `final.markup_apply`
- [x] 更新产物落盘与前端状态展示
- [x] 完成构建、smoke 与最终格式化验收
- [x] 复核是否仍需 Round 18

## 原子级清单

### A. 规划协议

- [x] A1. 定义终稿 block 切分与 blockIndex 规则
- [x] A2. 定义 AI 标记计划 JSON schema
- [x] A3. 明确“允许加符号，不允许改正文”的校验标准

### B. 回填脚本

- [x] B1. 实现终稿 block 切分与归并
- [x] B2. 实现 Markdown transform 内容保真校验
- [x] B3. 实现按计划回填 Markdown 符号
- [x] B4. 提供本地 mock/fallback 标记计划生成

### C. 链路接入

- [x] C1. 终修改回“只修正文，不负责最终 Markdown 装饰”
- [x] C2. 新增 `final.markup_plan` AI 步骤
- [x] C3. 新增 `final.markup_apply` 脚本步骤
- [x] C4. 结果中暴露最终标记计划与应用元数据
- [x] C5. PDF 导出改为基于回填后的最终 md

### D. 前端与产物

- [x] D1. 更新任务状态文案
- [x] D2. 更新结果类型定义
- [x] D3. 追加标记计划 artifact 落盘

### E. 验收

- [x] E1. `node --check server/deaiEngine.mjs`
- [x] E2. `node --check server/index.mjs`
- [x] E3. `npm.cmd run build`
- [x] E4. `npm.cmd run smoke`
- [x] E5. 执行最终 Markdown 标记链路与 PDF 下载验收

## 结束判定

1. 若本轮验收后仍暴露明确缺口，必须新建 `TODO_ROUND18_CN.md` 继续推进。
2. 若本轮验收未发现新的明确提升项，则本轮结束，不再继续开新 Todo。

## Round 17 结论

1. 终稿最后一步已改成“AI 只出 Markdown 标记计划，脚本执行安全回填”，不再让 AI 直接生成最终 Markdown 正文。
2. 标记规划 prompt 已放开为“允许使用全部 Markdown 符号，只要合适”，但脚本会校验不能改正文、不能新增正文信息。
3. 新增了 block 切分、plan schema、内容保真校验与回填执行模块，且 mock/fallback 也能跑完整闭环。
4. 终修正文、标记计划、最终终稿 md、最终 PDF 已拆分落盘，前端状态也补齐了 `final.markup_plan` 与 `final.markup_apply`。
5. 已完成 `node --check`、`npm.cmd run build`、`npm.cmd run smoke`、Markdown 标记计划模块验收与 PDF 下载验收。
6. 当前未再暴露新的明确缺口，因此不进入 `Round 18`。
