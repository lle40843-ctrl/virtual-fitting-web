const { callFalVirtualTryOn } = require("../backend/tryon-provider.cjs");

const maxUploadBytes = 16 * 1024 * 1024;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!process.env.FAL_KEY) {
    sendJson(res, 500, { error: "Vercel 环境变量 FAL_KEY 未配置" });
    return;
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    sendJson(res, 415, { error: "请使用 multipart/form-data 上传" });
    return;
  }

  try {
    const body = await readRequestBody(req);
    const { files } = parseMultipart(body, contentType);
    const personPhoto = files.personPhoto;
    const clothingPhoto = files.clothingPhoto;

    if (!personPhoto) {
      sendJson(res, 400, { error: "请上传自己的全身照" });
      return;
    }

    if (!clothingPhoto) {
      sendJson(res, 400, { error: "请上传衣服网图或模特试穿图" });
      return;
    }

    const result = await callFalVirtualTryOn({ personPhoto, clothingPhoto });

    sendJson(res, 200, {
      status: "done",
      result: {
        tryOnImageUrl: result.tryOnImageUrl,
        clothingImageUrl: "",
        clothingNote: result.note,
        provider: result.mode,
      },
    });
  } catch (error) {
    if (error.message === "UPLOAD_TOO_LARGE") {
      sendJson(res, 413, { error: "图片太大，请上传总计 16MB 以内的图片" });
      return;
    }
    sendJson(res, 500, { error: error.message || "生成失败" });
  }
};
