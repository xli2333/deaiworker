# de_ai_worker 原子级 Todo Round 15

更新时间：`2026-04-17`

## 本轮目标

1. 修正“中英/中数未留空格”被错误识别成问题的反向审查。
2. 把空格规则写死成“默认贴排，只有残留空格才是问题”。
3. 用最小化校验确认后端和构建都没回归。

## 当前进度

- [x] 建立本轮中文 Todo
- [x] 加强后端空格规则提示
- [x] 增加反向空格问题后处理拦截
- [x] 同步本地规则文案
- [x] 同步规则资产文案
- [x] 完成最小化校验

## 原子级清单

### A. 规则修复

- [x] A1. 明确“默认贴排，不留空格不是问题”
- [x] A2. 诊断与修订 prompt 禁止建议补空格
- [x] A3. 反向空格问题在标准化阶段直接丢弃或纠正
- [x] A4. 本地审查器的空格问题说明改成“残留空格”

### B. 资产同步

- [x] B1. `anti_ai_style_rules.md` 增补硬规则
- [x] B2. `commercial_humanizer_rules.md` 增补硬规则
- [x] B3. `commercial_humanizer_patterns.md` 增补反向示例
- [x] B4. `commercial_humanizer_quick_checks.md` 增补反向说明

### C. 验收

- [x] C1. `node --check server/deaiEngine.mjs`
- [x] C2. `npm.cmd run build`
