const STT_MODEL = "openai/whisper-large-v3-turbo";
const STT_URL = `https://router.huggingface.co/hf-inference/models/${STT_MODEL}`;
const CHUNK_MS = 4000;

const els = {
  transcript: document.getElementById("transcript"),
  micBtn: document.getElementById("micBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  fileInput: document.getElementById("fileInput"),
  clearBtn: document.getElementById("clearBtn"),
  status: document.getElementById("status"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsDialog: document.getElementById("settingsDialog"),
  hfToken: document.getElementById("hfToken"),
  saveTokenBtn: document.getElementById("saveTokenBtn"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
};

let recording = false;
let mediaStream = null;
let resultQueue = Promise.resolve();

function getToken() {
  return localStorage.getItem("hfToken") || "";
}

function showStatus(msg, ms = 2500) {
  els.status.textContent = msg;
  els.status.classList.add("show");
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => els.status.classList.remove("show"), ms);
}

function clearPlaceholder() {
  const ph = els.transcript.querySelector(".placeholder");
  if (ph) ph.remove();
}

function addLine(text, pending = false) {
  clearPlaceholder();
  const p = document.createElement("p");
  p.className = "line" + (pending ? " pending" : "");
  p.textContent = text;
  els.transcript.appendChild(p);
  p.scrollIntoView({ behavior: "smooth", block: "end" });
  return p;
}

async function callSTT(blob) {
  const token = getToken();
  if (!token) throw new Error("NO_TOKEN");

  let attempt = 0;
  while (attempt < 4) {
    let res;
    try {
      res = await fetch(STT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "audio/webm",
        },
        body: blob,
      });
    } catch (e) {
      throw new Error(`STT_NETWORK: ${e.message}`);
    }

    if (res.status === 503) {
      const data = await res.json().catch(() => ({}));
      const wait = Math.min((data.estimated_time || 5) * 1000, 15000);
      showStatus("모델을 준비 중이에요...");
      await new Promise((r) => setTimeout(r, wait));
      attempt++;
      continue;
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`STT_ERROR_${res.status}: ${bodyText.slice(0, 200)}`);
    }

    const data = await res.json();
    return (data.text || "").trim();
  }
  throw new Error("STT_TIMEOUT");
}

async function translateToKorean(text) {
  if (!text) return "";
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=${encodeURIComponent(
    text
  )}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`TRANSLATE_NETWORK: ${e.message}`);
  }
  if (!res.ok) throw new Error(`TRANSLATE_ERROR_${res.status}`);
  const data = await res.json();
  return data[0].map((seg) => seg[0]).join("");
}

async function handleAudio(blob, lineEl) {
  try {
    const original = await callSTT(blob);
    if (!original) {
      lineEl.remove();
      return;
    }
    const translated = await translateToKorean(original);
    lineEl.textContent = translated || original;
    lineEl.classList.remove("pending");
  } catch (err) {
    lineEl.textContent = describeError(err);
    lineEl.classList.remove("pending");
  }
}

function describeError(err) {
  const msg = (err && err.message) || String(err);
  if (msg === "NO_TOKEN") return "⚠️ 설정에서 Hugging Face 토큰을 먼저 입력하세요.";
  if (msg === "STT_TIMEOUT") return "⚠️ 모델 준비 시간이 초과됐어요. 다시 시도해주세요.";
  // 디버그 중: 원인을 바로 볼 수 있도록 실제 에러 메시지를 그대로 보여줍니다.
  return `⚠️ ${msg}`;
}

function enqueue(blob) {
  const lineEl = addLine("인식 중...", true);
  resultQueue = resultQueue.then(() => handleAudio(blob, lineEl));
}

function recordChunk(stream, ms) {
  return new Promise((resolve) => {
    const chunks = [];
    let mr;
    try {
      mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    } catch {
      mr = new MediaRecorder(stream);
    }
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => resolve(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
    mr.start();
    setTimeout(() => {
      if (mr.state !== "inactive") mr.stop();
    }, ms);
  });
}

async function recordLoop() {
  while (recording) {
    const blob = await recordChunk(mediaStream, CHUNK_MS);
    if (recording && blob.size > 2000) enqueue(blob);
  }
}

async function startRecording() {
  if (!getToken()) {
    showStatus("설정에서 Hugging Face 토큰을 먼저 입력하세요.");
    els.settingsDialog.showModal();
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showStatus("마이크 권한이 필요해요.");
    return;
  }
  recording = true;
  els.micBtn.classList.add("recording");
  els.micBtn.setAttribute("aria-label", "녹음 중지");
  recordLoop();
}

function stopRecording() {
  recording = false;
  els.micBtn.classList.remove("recording");
  els.micBtn.setAttribute("aria-label", "녹음 시작");
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

els.micBtn.addEventListener("click", () => {
  if (recording) stopRecording();
  else startRecording();
});

els.uploadBtn.addEventListener("click", () => els.fileInput.click());

els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files[0];
  els.fileInput.value = "";
  if (!file) return;
  if (!getToken()) {
    showStatus("설정에서 Hugging Face 토큰을 먼저 입력하세요.");
    els.settingsDialog.showModal();
    return;
  }
  enqueue(file);
});

els.clearBtn.addEventListener("click", () => {
  els.transcript.innerHTML = '<p class="placeholder">마이크 버튼을 눌러 시작하거나, 파일을 업로드하세요.</p>';
});

els.settingsBtn.addEventListener("click", () => {
  els.hfToken.value = getToken();
  els.settingsDialog.showModal();
});

els.saveTokenBtn.addEventListener("click", () => {
  localStorage.setItem("hfToken", els.hfToken.value.trim());
  els.settingsDialog.close();
  showStatus("저장됐어요.");
});

els.closeSettingsBtn.addEventListener("click", () => els.settingsDialog.close());

if (!getToken()) {
  setTimeout(() => els.settingsDialog.showModal(), 300);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
