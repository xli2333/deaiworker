# de_ai_worker 部署说明（Render + Vercel）

## 推荐拓扑

- `Render`：部署后端 Web Service
- `Vercel`：部署前端静态站点

原因：

- 后端存在长轮询任务、进程内任务状态和本地 artifact 落盘
- PDF 导出依赖 Python 与中文字体
- 这类后端更适合常驻进程，不适合直接放到 Vercel Functions

## 已补齐的部署配置

- `Dockerfile`
  用于 Render 后端，内含 Node 20、Python 3、`fpdf2` 和 `fonts-noto-cjk`
- `render.yaml`
  Render Blueprint 示例，当前按本仓库结构写成 `rootDir: de_ai_worker`
- `vercel.json`
  Vercel 前端构建配置
- `.env.example`
  补充了部署时会用到的环境变量
- 前端 API 基址
  现在支持 `VITE_API_BASE_URL`，Vercel 前端可直接请求 Render 后端
- `md2pdf.py`
  已补 Linux 字体查找逻辑，不再只认 Windows 字体目录

## 一、部署 Render 后端

### 方案 A：Render Dashboard 手动创建

1. 打开 Render，创建 `Web Service`
2. 连接你的 Git 仓库
3. 如果仓库根目录不是 `de_ai_worker`，把 `Root Directory` 设为 `de_ai_worker`
4. `Runtime` 选择 `Docker`
5. Render 会读取 `de_ai_worker/Dockerfile`
6. 环境变量至少设置：

```env
PORT=10000
BACKEND_HOST=0.0.0.0
DEAI_OUTPUT_ROOT=/app/outputs/tasks
```

7. 部署完成后，访问：

```txt
https://你的-render-域名/api/health
```

如果返回 `ok: true`，说明后端正常。

### 方案 B：用 Blueprint

如果你想用 Blueprint：

1. 在 Render 里选择 `Blueprint`
2. 指定配置文件路径为 `de_ai_worker/render.yaml`
3. 继续创建服务

注意：当前 `render.yaml` 是按本仓库结构写的，`rootDir` 已设置为 `de_ai_worker`。

### Render 额外说明

- 当前任务状态保存在进程内存里，所以后端不要横向扩成多实例
- `outputs/tasks` 默认写本地磁盘，服务重启后历史任务和 artifact 可能丢失
- 如果你要长期保留 artifact，建议后续给 Render 挂持久盘或改对象存储

## 二、部署 Vercel 前端

1. 在 Vercel 导入同一个 Git 仓库
2. `Root Directory` 设为 `de_ai_worker`
3. Framework 选择 `Vite`
4. Build Command 保持为：

```txt
npm run build
```

5. Output Directory 设为：

```txt
dist
```

6. 在 Vercel 环境变量里设置：

```env
VITE_API_BASE_URL=https://你的-render-域名
```

注意：

- 不要带结尾 `/`
- 例如写成 `https://de-ai-worker-api.onrender.com`

部署完成后，前端会直接请求 Render 后端。

## 三、上线后的最小验收

### 1. Render 健康检查

打开：

```txt
https://你的-render-域名/api/health
```

预期：

- `ok: true`

### 2. Vercel 页面打开

打开 Vercel 域名，确认页面能加载。

### 3. API Key 校验

在页面输入 Gemini API Key，点击校验。

预期：

- 前端不报跨域错误
- 后端返回模型校验结果

### 4. 跑一条真实任务

上传一个 `.md` 或 `.docx` 文档，确认流程能进入：

```txt
humanizer.initial
audit.initial
final.polish
final.markup_plan
final.markup_apply
```

### 5. PDF 验证

任务完成后点击下载 PDF。

如果 PDF 失败，优先检查：

- Render 日志里是否有 `python3` / 字体相关报错
- `md2pdf.py` 是否拿到了可用 CJK 字体

## 四、建议的自定义域名

- Vercel 前端：`deai.yourdomain.com`
- Render 后端：`deai-api.yourdomain.com`

然后把：

```env
VITE_API_BASE_URL=https://deai-api.yourdomain.com
```

配到 Vercel。

## 五、当前限制

- 后端任务状态是内存态，重启即丢
- artifact 默认落本地目录，不是长期存储
- 如需多实例、任务恢复、长期归档，后续要把 job store 与 artifact store 外置
