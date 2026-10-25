import {
  DEFAULT_CONFIG, base64ToBytes, buildPublicUrl, checkImageShape, configProblem, normalizeFolder, sanitizeFilename,
} from "./lib.js";
import { getExisting, putFile } from "./github.js";

const $ = (id) => document.getElementById(id);
const jobKey = `job:${new URLSearchParams(location.search).get("job")}`;

let cfg, job, folder;
let allowOverwrite = false;

function setStatus(kind, text) {
  const el = $("status");
  el.hidden = !text;
  el.className = `box ${kind}`;
  el.textContent = text || "";
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon128.png"),
    title,
    message,
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

const currentName = () => sanitizeFilename($("filename").value, job.mime);

function refreshTarget() {
  $("target").textContent = folder + currentName();
}

async function upload() {
  $("upload").disabled = true;
  $("overwrite").hidden = true;
  setStatus("", "Checking the repo…");
  const name = currentName();
  const path = folder + name;
  try {
    const existing = await getExisting(cfg, path);
    if (existing.exists && !allowOverwrite) {
      $("exists-name").textContent = path;
      $("form").hidden = true;
      $("overwrite").hidden = false;
      setStatus("", "");
      return;
    }
    setStatus("", "Uploading…");
    await putFile(cfg, path, job.b64, `Add icon: ${name}`, existing.exists ? existing.sha : undefined);

    const url = buildPublicUrl(cfg, name);
    const copied = await copyText(url);
    notify("Icon uploaded", copied ? `${url}\n(copied to clipboard)` : `${url}\n(couldn't copy automatically)`);
    setStatus("ok", `${copied ? "Copied to clipboard" : "Uploaded (copy failed)"}: ${url}`);
    $("form").hidden = true;
    setTimeout(() => window.close(), 3000);
  } catch (err) {
    const msg = err.message || String(err);
    notify("Icon upload failed", msg);
    setStatus("err", msg);
    $("form").hidden = false;
    $("upload").disabled = false;
    allowOverwrite = false;
  }
}

async function init() {
  const stored = await chrome.storage.session.get(jobKey);
  job = stored[jobKey];
  if (!job) return setStatus("err", "This upload request expired. Right-click the image again.");

  const { config } = await chrome.storage.local.get("config");
  cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const problem = configProblem(cfg);
  if (problem) return setStatus("err", problem + " Open the extension options to fix it.");
  folder = normalizeFolder(cfg.folder);

  $("filename").value = job.suggested;
  refreshTarget();
  $("filename").addEventListener("input", refreshTarget);
  $("filename").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("upload").disabled) upload(); });
  $("cancel").addEventListener("click", () => window.close());
  $("upload").addEventListener("click", upload);
  $("overwrite-no").addEventListener("click", () => window.close());
  $("overwrite-yes").addEventListener("click", () => { allowOverwrite = true; $("form").hidden = false; upload(); });

  const img = $("preview");
  const finish = (w, h) => {
    const warnings = checkImageShape(w, h);
    $("meta").textContent = `${job.mime}, ${w && h ? `${w}×${h}` : "size unknown"}, ${(base64ToBytes(job.b64).length / 1024).toFixed(1)} KB`;
    if (warnings.length) {
      const box = $("warn");
      box.hidden = false;
      box.replaceChildren(...warnings.map((t) => Object.assign(document.createElement("p"), { textContent: t })));
      box.append(Object.assign(document.createElement("p"), { textContent: "Upload anyway, or cancel?" }));
      $("upload").textContent = "Upload anyway";
    }
    $("upload").disabled = false;
    $("filename").focus();
    $("filename").select();
  };
  img.onload = () => finish(img.naturalWidth, img.naturalHeight);
  img.onerror = () => finish(0, 0);
  img.src = URL.createObjectURL(new Blob([base64ToBytes(job.b64)], { type: job.mime }));
}

window.addEventListener("pagehide", () => { chrome.storage.session.remove(jobKey); });
init().catch((err) => setStatus("err", err.message || String(err)));
