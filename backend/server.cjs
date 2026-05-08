const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { callVirtualTryOn } = require("./tryon-provider.cjs");

const root = __dirname;
const port = Number(process.env.BACKEND_PORT || process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const uploadDir = path.join(root, "uploads");
const maxUploadBytes = 16 * 1024 * 1024;

const jobs = new Map();
const types = {
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const steps = [
  "分析人物照片",
  "识别衣服图片",
  "调用试衣模型",
  "渲染试穿效果",
  "生成结果预览",
];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxUploadBytes) {
        reject(new Error("UPLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(body, contentType) {
  const boundary =
    contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ||
    contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];

  if (!boundary) {
    throw new Error("Missing multipart boundary");
  }

  const fields = {};
  const files = {};
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = body.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    const next = body.indexOf(boundaryBuffer, cursor + boundaryBuffer.length);
    if (next === -1) break;
    parts.push(body.subarray(cursor + boundaryBuffer.length, next));
    cursor = next;
  }

  for (const rawPart of parts) {
    let part = rawPart;
    if (part.subarray(0, 2).equals(Buffer.from("\r\n"))) part = part.subarray(2);
    if (part.subarray(0, 2).equals(Buffer.from("--"))) continue;

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headerText = part.subarray(0, headerEnd).toString("utf8");
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(-2).equals(Buffer.from("\r\n"))) {
      content = content.subarray(0, -2);
    }

    const name = headerText.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;

    const filename = headerText.match(/filename="([^"]*)"/)?.[1];
    const type = headerText.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "";

    if (filename) {
      files[name] = { filename, type, content };
    } else {
      fields[name] = content.toString("utf8");
    }
  }

  return { fields, files };
}

function getProgress(job) {
  if (job.status === "done") return 100;
  if (job.status === "failed") return job.progress || 100;

  const elapsed = Date.now() - job.createdAt;
  return Math.min(95, Math.floor((elapsed / 15000) * 100));
}

function getStep(progress) {
  const index = Math.min(steps.length - 1, Math.floor((progress / 100) * steps.length));
  return steps[index];
}

function imageExtension(file) {
  const ext = path.extname(file.filename).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext;
  if (file.type === "image/png") return ".png";
  if (file.type === "image/webp") return ".webp";
  return ".jpg";
}

async function saveUploadedImage(jobId, kind, file) {
  const fileName = `${jobId}-${kind}${imageExtension(file)}`;
  const filePath = path.join(uploadDir, fileName);
  await fsp.writeFile(filePath, file.content);
  return `/uploads/${fileName}`;
}

async function runTryOnJob(jobId, personPhoto, clothingPhoto, garmentCategory) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    const result = await callVirtualTryOn({ personPhoto, clothingPhoto, garmentCategory });
    const current = jobs.get(jobId);
    if (!current) return;

    current.status = "done";
    current.progress = 100;
    current.step = steps[steps.length - 1];
    current.finishedAt = Date.now();
    current.provider = result.mode;
    current.tryOnImageUrl = result.tryOnImageUrl || current.personImageUrl;
    current.clothingNote = result.note;
  } catch (error) {
    const current = jobs.get(jobId);
    if (!current) return;

    current.status = "failed";
    current.progress = 100;
    current.step = "生成失败";
    current.error = error.message || "生成任务失败";
    current.finishedAt = Date.now();
  }
}

async function createTryOnJob(req, res) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    sendJson(res, 415, { error: "请使用 multipart/form-data 上传" });
    return;
  }

  try {
    const body = await readRequestBody(req);
    const { fields, files } = parseMultipart(body, contentType);
    const personPhoto = files.personPhoto;
    const clothingPhoto = files.clothingPhoto;
    const garmentCategory = fields.garmentCategory || "upper";

    if (!personPhoto) {
      sendJson(res, 400, { error: "请上传自己的全身照" });
      return;
    }

    if (!clothingPhoto) {
      sendJson(res, 400, { error: "请上传衣服网图或模特试穿图" });
      return;
    }

    await fsp.mkdir(uploadDir, { recursive: true });

    const jobId = crypto.randomUUID();
    const personImageUrl = await saveUploadedImage(jobId, "person", personPhoto);
    const clothingImageUrl = await saveUploadedImage(jobId, "clothing", clothingPhoto);

    const job = {
      id: jobId,
      status: "running",
      progress: 0,
      step: steps[0],
      createdAt: Date.now(),
      finishedAt: null,
      gender: fields.gender || "",
      height: fields.height || "",
      weight: fields.weight || "",
      garmentCategory,
      personImageUrl,
      clothingImageUrl,
      tryOnImageUrl: "",
      clothingNote: "衣服图片已上传，正在等待试衣模型",
      provider: "",
      error: "",
    };
    jobs.set(jobId, job);
    runTryOnJob(jobId, personPhoto, clothingPhoto, garmentCategory);

    sendJson(res, 202, { jobId });
  } catch (error) {
    if (error.message === "UPLOAD_TOO_LARGE") {
      sendJson(res, 413, { error: "图片太大，请上传总计 16MB 以内的图片" });
      return;
    }
    sendJson(res, 500, { error: error.message || "创建任务失败" });
  }
}

function readJob(res, jobId, includeResult = false) {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(res, 404, { error: "任务不存在" });
    return;
  }

  const progress = getProgress(job);
  if (job.status === "running") {
    job.progress = progress;
    job.step = getStep(progress);
  }

  const payload = {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    step: job.step,
    error: job.error,
  };

  if (includeResult || job.status === "done") {
    payload.result = {
      personImageUrl: job.personImageUrl,
      clothingImageUrl: job.clothingImageUrl,
      tryOnImageUrl: job.tryOnImageUrl || job.personImageUrl,
      clothingNote: job.clothingNote,
      provider: job.provider || "mock",
      videoPreview: "mock-turntable",
    };
  }

  sendJson(res, 200, payload);
}

function serveUpload(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = urlPath.replace("/uploads/", "");
  const filePath = path.resolve(uploadDir, relative);

  if (!filePath.startsWith(uploadDir)) {
    res.writeHead(403, corsHeaders());
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, corsHeaders());
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      ...corsHeaders(),
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        falConfigured: Boolean(process.env.FAL_KEY),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/try-on") {
      createTryOnJob(req, res);
      return;
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)(?:\/result)?$/);
    if (req.method === "GET" && jobMatch) {
      readJob(res, jobMatch[1], pathname.endsWith("/result"));
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/uploads/")) {
      serveUpload(req, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  })
  .listen(port, host, () => {
    console.log(`Backend API running at http://${host}:${port}`);
  });
