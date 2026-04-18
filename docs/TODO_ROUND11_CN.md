# de_ai_worker 原子级 Todo Round 11

更新时间：`2026-04-17`

## 本轮目标

1. 把真实生产链路的超时统一拉长到 20 分钟级别，避免 Gemini 请求或 Node 服务默认超时先中断。
2. 让取消任务能中止当前模型请求，而不是只能等这一轮请求自然返回。
3. 把当前超时配置暴露到健康检查和烟测里，保证生产前可见、可验、可回归。

## 当前进度

- [x] 建立本轮中文 Todo
- [x] 统一服务端超时配置
- [x] 统一 Gemini 请求超时与取消信号
- [x] 暴露健康检查超时信息
- [x] 完成烟测回归
- [x] 复核是否还存在明确的超时闭环缺口

## 本轮结果

- 已新增统一运行时超时配置模块，后端 HTTP 与 Gemini 请求默认超时都提升到 20 分钟级别。
- 已接入任务取消信号，当前模型请求可被中止，不再只能等一轮请求自然返回。
- 健康检查已返回当前超时配置，烟测已验证 `requestMs / headersMs / socketMs` 均达到 20 分钟级别。
- 本轮真实最小链路已验证 `validateApiKey` 与完整短样稿流程可走通。
- 真实短样稿回放又暴露出“最终审计未通过仍进入终修”的流程缺口，因此已进入 Round 12 继续收口。

## 原子级清单

### A. 服务端超时

- [x] A1. 新增统一运行时超时配置模块
- [x] A2. `server/index.mjs` 设置 `requestTimeout / headersTimeout / keepAliveTimeout / timeout`
- [x] A3. 健康检查接口返回当前超时配置，便于真实环境核验

### B. 模型请求超时

- [x] B1. Gemini `generateContent / countTokens` 默认超时拉长到 20 分钟
- [x] B2. 任务取消时中止当前模型请求
- [x] B3. 超时错误返回明确错误码，且不做无意义重试

### C. 回归验收

- [x] C1. `node --check server/index.mjs`
- [x] C2. `node --check server/deaiEngine.mjs`
- [x] C3. `npm run build`
- [x] C4. `npm run smoke`
- [x] C5. 验证健康检查已返回 20 分钟级超时配置
