# de_ai_worker 原子级 Todo Round 18

更新时间：`2026-04-17`

## 本轮目标

1. 修复“最终审计摘要已判通过，但因 `ready` 字段矛盾而错误跳过终修和回填”的真实流程缺口。
2. 统一审计 / 去AI报告里的 `ready / verdict / issues` 语义，避免模型字段互相打架时把流程带偏。
3. 验证通过后的任务一定会进入 `final.polish -> final.markup_plan -> final.markup_apply`。

## 当前进度

- [x] 建立本轮中文 Todo
- [x] 统一审计结论归一化逻辑
- [x] 修复最终通过闸门判断
- [x] 验证真实状态流会进入回填步骤
- [x] 完成构建与 smoke 验收
- [x] 复核是否仍需 Round 19

## 原子级清单

### A. 结论归一化

- [x] A1. 收紧 humanizer 报告的 `ready` 归一化
- [x] A2. 收紧 audit 报告的 `ready / verdict` 归一化
- [x] A3. 抽出统一的 `isHumanizerReady` / `isAuditApproved` helper
- [x] A4. 保留 issue recovery，对“字段说未通过但 issues 丢失”的情况先尝试恢复

### B. 流程修复

- [x] B1. 多轮审计循环改用统一通过判定
- [x] B2. 终修与回填闸门改用统一通过判定
- [x] B3. `workflowMeta.finalSkipped` 改用统一通过判定
- [x] B4. 消除 `verdict: pass` 但 `ready: no` 时被误判跳过的问题

### C. 验收

- [x] C1. `node --check server/deaiEngine.mjs`
- [x] C2. `npm.cmd run build`
- [x] C3. `npm.cmd run smoke`
- [x] C4. smoke 结果已实际进入 `final.markup_apply`

## 结果

- 已修复：最终审计通过后，不会再因为孤立的 `ready: no` 把终修和 Markdown 回填跳过。
- 已验证：本轮 smoke 明确经过 `final.markup_apply`，说明回填步骤已真实执行。
- 已验证：当前没有新的明确阻塞项，本轮收口，不新开 `TODO_ROUND19_CN.md`。
