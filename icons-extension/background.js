import {
  DEFAULT_CONFIG, MAX_BYTES, configProblem, extForMime, parseDataUrl, sniffMime, suggestFilename, bytesToBase64,
} from "./lib.js";

const MENU_ID = "send-to-icons-repo";

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon128.png"),
    title,
    message,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Send to icons repo", contexts: ["image"] });
  });
});

async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { ...DEFAULT_CONFIG, ...(config || {}) };
}

async function fetchImage(srcUrl) {
  if (srcUrl.startsWith("data:")) return parseDataUrl(srcUrl);
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`Couldn't download the image (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { mime: res.headers.get("content-type") || "", bytes };
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  try {
    const cfg = await loadConfig();
    const problem = configProblem(cfg);
    if (problem) {
      notify("Send to icons repo: setup needed", `${problem} Opening the options page.`);
      chrome.runtime.openOptionsPage();
      return;
    }

    const { mime: headerMime, bytes } = await fetchImage(info.srcUrl);
    if (bytes.length > MAX_BYTES) {
      throw new Error(`Image is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${MAX_BYTES / 1048576} MB.`);
    }
    // Prefer what the bytes really are over what the server claimed.
    const mime = sniffMime(bytes) || (extForMime(headerMime) ? headerMime.split(";")[0].trim() : null);
    if (!mime) throw new Error("That doesn't look like an image file (the server may have returned a web page).");

    const id = crypto.randomUUID();
    await chrome.storage.session.set({
      [`job:${id}`]: { b64: bytesToBase64(bytes), mime, suggested: suggestFilename(info.srcUrl, mime) },
    });
    await chrome.windows.create({
      url: chrome.runtime.getURL(`prompt.html?job=${id}`),
      type: "popup",
      width: 480,
      height: 640,
    });
  } catch (err) {
    notify("Send to icons repo: failed", err.message || String(err));
  }
});
