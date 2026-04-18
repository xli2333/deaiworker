# de_ai_worker 原子级 Todo Round 12

更新时间：`2026-04-17`

## 本轮目标

1. 把“最终审计复检未通过仍进入终修”的流程缺口补上。
2. 审计未通过时明确停在审计阶段，并把问题继续暴露给前端，而不是假装已经终修完成。
3. 用真实 Gemini 短样稿再次回放，确认流程门禁与状态展示一致。

## 当前进度

- [x] 建立本轮中文 Todo
- [x] 增加最终审计门禁
- [x] 审计未通过时跳过终修并保留问题暴露
- [x] 完成真实短样稿回放验收
- [x] 完成烟测回归

## 本轮结果

- 已改成只有 `auditFinalReportJson.ready === yes` 时才进入 `final.polish`。
- 审计未通过时会发出 `final.skipped` 状态，消息为“最终审计未通过，已跳过终修。”
- 审计未通过时 `finalText` 直接保持 `auditedText`，不再由终修模型覆盖。
- 真实短样稿回放已验证门禁生效：`auditFinalReady = no` 时，`finalEqualsAudited = true`，最后状态为 `final.skipped`。
- 烟测回归通过，没有引入新的链路回归。

## 原子级清单

### A. 流程门禁

- [x] A1. 只有 `auditFinalReportJson.ready === yes` 时才进入 `final.polish`
- [x] A2. 审计未通过时发出明确状态消息
- [x] A3. 审计未通过时 `finalText` 不再由模型终修覆盖

### B. 验收

- [x] B1. `node --check server/deaiEngine.mjs`
- [x] B2. 真实短样稿回放验证门禁生效
- [x] B3. `npm run smoke`
