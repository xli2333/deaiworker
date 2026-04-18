# de_ai_worker 原子级 Todo Round 16

更新时间：`2026-04-17`

## 本轮目标

1. 给最终终稿增加稳定的 Markdown 格式整形，让成文更专业。
2. 接入基于 `md2pdf.py` 的 PDF 导出能力，并把下载入口接到前端。
3. 把去AI/审计链路改成“继续收敛直到没有明确提升空间或达到安全上限”，避免只跑单轮。
4. 完成最小化真实验收；如果还有明确提升空间，再进入 Round 17。

## 当前进度

- [x] 建立本轮中文 Todo
- [x] 实现最终 Markdown 格式整形
- [x] 实现多轮收敛式去AI/审计闭环
- [x] 接入 PDF 产物导出与结果暴露
- [x] 补前端 PDF 下载入口
- [x] 完成最小化构建与导出验收
- [x] 复核是否仍需 Round 17

## 原子级清单

### A. 最终 Markdown

- [x] A1. 在终修 prompt 中明确要求返回可直接交付的 Markdown
- [x] A2. 新增本地 Markdown 结构整形兜底
- [x] A3. 确保终稿至少具备稳定标题与段落/小节结构

### B. 多轮收敛

- [x] B1. 去AI链路改为有上限的多轮修订与复检
- [x] B2. 审计链路改为有上限的多轮修订与复检
- [x] B3. 增加“无文本变化 / 问题签名不再收敛”停机条件

### C. PDF 导出

- [x] C1. 修正 `md2pdf.py` 中会影响中文输出的异常字符逻辑
- [x] C2. 后端写入终稿后自动生成 PDF
- [x] C3. 结果数据中暴露 PDF 产物名
- [x] C4. 提供服务端 artifact 下载接口
- [x] C5. 前端增加 PDF 下载按钮

### D. 验收

- [x] D1. `node --check server/deaiEngine.mjs`
- [x] D2. `node --check server/index.mjs`
- [x] D3. `npm.cmd run build`
- [x] D4. 执行一次最小 PDF 导出验收

## 结束判定

1. 若本轮验收后仍暴露明确缺口，必须新建 `TODO_ROUND17_CN.md` 继续推进。
2. 若本轮验收未发现新的明确提升项，则本轮结束，不再继续开新 Todo。

## Round 16 结论

1. 终稿终修已明确改为返回可直接交付的 Markdown，并增加本地结构整形兜底。
2. 去AI与最终审计已改为有上限的多轮收敛流程，且加入“文本不再变化 / 问题签名不再收敛”的停机条件。
3. `md2pdf.py` 已接入服务端落盘链路，任务成功后会生成 `10_final_text.pdf`。
4. 新增 artifact 下载接口与前端 PDF 按钮，实测可下载生成的 PDF 二进制文件。
5. 已完成 `node --check`、`npm.cmd run build`、`npm.cmd run smoke` 与 PDF 下载验收；本轮未再暴露新的明确缺口，因此不进入 `Round 17`。
