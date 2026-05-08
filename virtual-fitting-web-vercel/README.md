# Virtual Fitting Web

零依赖的网页版虚拟试衣原型，已拆成独立前端和后端。

## 目录

```txt
frontend/   静态 Web 前端
backend/    Node.js API 后端
scripts/    本地开发启动脚本
```

## 本地启动

```powershell
.\start-dev.ps1
```

启动后访问：

```txt
http://127.0.0.1:5173
```

后端 API：

```txt
http://127.0.0.1:8787
```

## fal.ai 配置

后端会从环境变量读取 fal.ai key：

```powershell
$env:FAL_KEY="your-fal-key"
```

如果没有配置 `FAL_KEY`，后端会走本地预览模式，不会调用真实试衣模型。

## 当前 API

- `POST /api/try-on`：上传 `gender`、`height`、`weight`、`personPhoto`、`clothingPhoto`
- `GET /api/jobs/:id`：查询任务进度
- `GET /api/jobs/:id/result`：查询任务结果
- `GET /health`：健康检查，并返回 fal 是否已配置

## 上线改造

当前后端把上传文件保存到 `backend/uploads/`。上线时应替换为云存储，例如 Cloudflare R2、S3、腾讯云 COS 或 Supabase Storage。

真实试衣效果图已通过 `backend/tryon-provider.cjs` 接入 fal.ai。后续可以把 fal 返回的生成图下载并保存到云存储，再把云存储 URL 返回给前端。

## Vercel 部署

项目已包含 Vercel 配置：

```txt
vercel.json
api/try-on.js
api/health.js
```

第一版 Vercel 上线不依赖 Cloudflare R2。Vercel Function 会直接接收两张上传图，调用 fal.ai，并把 fal 返回的生成图 URL 返回给前端。

需要在 Vercel 项目后台配置环境变量：

```txt
FAL_KEY=your-fal-key
```

配置路径：

```txt
Vercel Project -> Settings -> Environment Variables
```

保存后重新部署一次。

上线后检查：

```txt
https://your-domain.vercel.app/api/health
```

如果返回：

```json
{"ok":true,"falConfigured":true}
```

说明 fal key 已经配置成功。

后续如果要保存用户上传图、生成图、历史记录，再接 Cloudflare R2 或 Vercel Blob。
