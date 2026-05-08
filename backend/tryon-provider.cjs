const FAL_MODEL = process.env.FAL_MODEL || "fal-ai/image-apps-v2/virtual-try-on";

function fileToDataUri(file) {
  const mimeType = file.type || "image/jpeg";
  return `data:${mimeType};base64,${file.content.toString("base64")}`;
}

function findImageUrl(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findImageUrl(item);
      if (result) return result;
    }
    return "";
  }

  if (typeof value === "object") {
    for (const key of ["url", "image_url", "try_on_image_url"]) {
      const result = findImageUrl(value[key]);
      if (result) return result;
    }

    for (const key of ["image", "images", "output", "result", "data"]) {
      const result = findImageUrl(value[key]);
      if (result) return result;
    }
  }

  return "";
}

async function callFalVirtualTryOn({ personPhoto, clothingPhoto }) {
  if (!process.env.FAL_KEY) {
    return {
      mode: "mock",
      tryOnImageUrl: "",
      note: "未配置 FAL_KEY，当前显示上传图预览",
      raw: null,
    };
  }

  const response = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      person_image_url: fileToDataUri(personPhoto),
      clothing_image_url: fileToDataUri(clothingPhoto),
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }

  if (!response.ok) {
    const detail = payload.detail || payload.error || payload.message || response.statusText;
    throw new Error(`fal.ai 生成失败：${detail}`);
  }

  const tryOnImageUrl = findImageUrl(payload);
  if (!tryOnImageUrl) {
    throw new Error("fal.ai 已返回结果，但没有找到生成图片 URL");
  }

  return {
    mode: "fal",
    tryOnImageUrl,
    note: "fal.ai 已生成试穿效果图",
    raw: payload,
  };
}

module.exports = {
  callFalVirtualTryOn,
};
