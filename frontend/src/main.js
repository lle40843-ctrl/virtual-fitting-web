import { API_BASE_URL } from "./config.js";

const form = document.querySelector("#tryOnForm");
const appStatus = document.querySelector("#appStatus");
const resultStage = document.querySelector("#resultStage");
const resultHint = document.querySelector("#resultHint");
const progressArea = document.querySelector("#progressArea");
const progressFill = document.querySelector("#progressFill");
const progressLabel = document.querySelector("#progressLabel");
const progressValue = document.querySelector("#progressValue");

const personInput = document.querySelector("#personPhoto");
const clothingInput = document.querySelector("#clothingPhoto");
const personPreview = document.querySelector("#personPreview");
const clothingPreview = document.querySelector("#clothingPreview");

let pollingTimer = null;

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

function renderImagePreview(input, container, fallbackText) {
  const file = input.files?.[0];
  if (!file) {
    container.innerHTML = `<span>${fallbackText}</span>`;
    return;
  }

  const url = URL.createObjectURL(file);
  container.innerHTML = "";
  const image = document.createElement("img");
  image.src = url;
  image.alt = fallbackText;
  image.onload = () => URL.revokeObjectURL(url);
  container.append(image);
}

function setProgress(percent, label) {
  progressFill.style.width = `${percent}%`;
  progressValue.textContent = `${percent}%`;
  progressLabel.textContent = label;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setBusy(isBusy) {
  form.querySelectorAll("input, select, button").forEach((element) => {
    element.disabled = isBusy;
  });
}

function renderGeneratedResult(result) {
  const mainImageUrl = result.tryOnImageUrl || result.personImageUrl;
  const providerText =
    result.provider === "fal"
      ? "fal.ai 真实试衣图"
      : result.provider === "huggingface"
        ? "Hugging Face 免费试衣图"
        : "本地预览图";
  const garmentImage = result.clothingImageUrl
    ? `<img class="garment-image" src="${escapeHtml(assetUrl(result.clothingImageUrl))}" alt="上传的服饰图片" />`
    : `<div class="garment-image garment-empty">服饰图</div>`;

  resultStage.innerHTML = `
    <div class="result-preview stacked-result">
      <div class="model-card">
        <img src="${escapeHtml(assetUrl(mainImageUrl))}" alt="试穿效果图预览" />
      </div>
      <div class="video-card">
        <div class="garment-strip">
          ${garmentImage}
          <div>
            <strong>${escapeHtml(providerText)}</strong>
            <span>${escapeHtml(result.clothingNote || "服饰图片已接收")}</span>
          </div>
        </div>
        <div class="turntable" aria-label="站立环绕视频预览">
          <div class="person-silhouette"></div>
        </div>
        <div class="orbit-label">
          <span>视频预览</span>
          <span>下一阶段接入</span>
        </div>
      </div>
    </div>
  `;
}

function renderError(message) {
  appStatus.textContent = "失败";
  resultHint.textContent = message;
  progressArea.hidden = true;
  resultStage.innerHTML = `
    <div class="empty-state">
      <div class="empty-mark">!</div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

async function pollJob(jobId) {
  const response = await fetch(apiUrl(`/api/jobs/${jobId}`));
  const job = await response.json();

  if (!response.ok) {
    throw new Error(job.error || "查询任务失败");
  }

  setProgress(job.progress, job.step);

  if (job.status === "done") {
    window.clearInterval(pollingTimer);
    pollingTimer = null;
    appStatus.textContent = "已生成";
    resultHint.textContent =
      job.result.provider === "fal" || job.result.provider === "huggingface"
        ? "已生成试穿效果图"
        : "当前显示上传图预览";
    progressArea.hidden = true;
    renderGeneratedResult(job.result);
    setBusy(false);
    return;
  }

  if (job.status === "failed") {
    throw new Error(job.error || "生成任务失败");
  }
}

async function startTryOnJob() {
  const formData = new FormData(form);

  appStatus.textContent = "上传中";
  resultHint.textContent = "正在上传人物照片和服饰图片";
  progressArea.hidden = false;
  setProgress(0, "创建生成任务");
  setBusy(true);

  const response = await fetch(apiUrl("/api/try-on"), {
    method: "POST",
    body: formData,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "创建任务失败");
  }

  if (payload.status === "done" && payload.result) {
    appStatus.textContent = "已生成";
    resultHint.textContent = "已生成试穿效果图";
    progressArea.hidden = true;
    renderGeneratedResult(payload.result);
    setBusy(false);
    return;
  }

  appStatus.textContent = "生成中";
  resultHint.textContent = "后端正在调用试衣模型";
  setProgress(5, "任务已创建");

  pollingTimer = window.setInterval(() => {
    pollJob(payload.jobId).catch((error) => {
      window.clearInterval(pollingTimer);
      pollingTimer = null;
      setBusy(false);
      renderError(error.message);
    });
  }, 1000);
}

personInput.addEventListener("change", () => {
  renderImagePreview(personInput, personPreview, "上传全身照");
});

clothingInput.addEventListener("change", () => {
  renderImagePreview(clothingInput, clothingPreview, "上传服饰网图");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  if (pollingTimer) {
    window.clearInterval(pollingTimer);
    pollingTimer = null;
  }

  startTryOnJob().catch((error) => {
    setBusy(false);
    renderError(error.message);
  });
});

form.addEventListener("reset", () => {
  if (pollingTimer) {
    window.clearInterval(pollingTimer);
    pollingTimer = null;
  }

  window.setTimeout(() => {
    setBusy(false);
    personPreview.innerHTML = "<span>上传全身照</span>";
    clothingPreview.innerHTML = "<span>上传服饰网图</span>";
    resultStage.innerHTML = `
      <div class="empty-state">
        <div class="empty-mark">360</div>
        <p>生成后上半部分展示试穿效果图，下半部分展示视频预览。</p>
      </div>
    `;
    resultHint.textContent = "填写信息并上传两张图片后开始生成";
    appStatus.textContent = "待上传";
    progressArea.hidden = true;
    setProgress(0, "分析人物照片");
  }, 0);
});
