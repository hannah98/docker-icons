// Pure helpers shared by the background worker, the upload window and the options page.
// No chrome.* calls in here so everything can be unit-tested with plain Node.

export const MAX_DIM = 600;
export const MAX_BYTES = 5 * 1024 * 1024; // chrome.storage.session holds the job; keep well under its 10 MB quota

export const DEFAULT_CONFIG = {
  owner: "",
  repo: "",
  branch: "main",
  folder: "icons/",
  token: "",
  publicBase: "",
};

const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/avif": "avif",
};

export function extForMime(mime) {
  return MIME_EXT[(mime || "").split(";")[0].trim().toLowerCase()] || null;
}

export function sniffMime(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "image/x-icon";
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

/** lowercase, hyphens, no spaces, ascii only */
export function sanitizeBaseName(s) {
  const out = String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return out || "icon";
}

function splitExt(name) {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return [name, ""];
  const ext = name.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? [name.slice(0, i), ext] : [name, ""];
}

/**
 * Final filename: sanitized base + an extension that matches the real image type
 * (so a PNG is always .png). If the type is unknown, keep a sane typed extension or fall back to png.
 */
export function sanitizeFilename(input, mime) {
  const [base, typedExt] = splitExt(String(input || "").trim());
  const ext = extForMime(mime) || typedExt || "png";
  return `${sanitizeBaseName(base)}.${ext}`;
}

/** Suggest a filename from the image URL. */
export function suggestFilename(srcUrl, mime) {
  let name = "";
  try {
    const u = new URL(srcUrl);
    if (u.protocol !== "data:") {
      const seg = u.pathname.split("/").filter(Boolean).pop() || "";
      try { name = decodeURIComponent(seg); } catch { name = seg; }
    }
  } catch { /* not a URL: fall through to default */ }
  return sanitizeFilename(name, mime);
}

export function parseDataUrl(url) {
  const m = /^data:([^,]*?),(.*)$/s.exec(url);
  if (!m) throw new Error("Not a valid data: URL");
  const meta = m[1].split(";");
  const isB64 = meta.includes("base64");
  const mime = meta[0] || "text/plain";
  let bytes;
  if (isB64) {
    bytes = base64ToBytes(decodeURIComponent(m[2]));
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(m[2]));
  }
  return { mime, bytes };
}

export function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function normalizeFolder(f) {
  const t = String(f || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!t) return "";
  return t.endsWith("/") ? t : t + "/";
}

export function defaultPublicBase(cfg) {
  return `https://cdn.jsdelivr.net/gh/${cfg.owner}/${cfg.repo}@${cfg.branch}/${normalizeFolder(cfg.folder)}`;
}

export function buildPublicUrl(cfg, filename) {
  let base = (cfg.publicBase || "").trim() || defaultPublicBase(cfg);
  if (!base.endsWith("/")) base += "/";
  return base + encodeURIComponent(filename);
}

/** Encode each path segment but keep the slashes. */
export function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Returns a list of human-readable warnings; empty if the image is fine. */
export function checkImageShape(w, h) {
  if (!w || !h) return ["Couldn't read the image dimensions (common for SVGs without a size)."];
  const warnings = [];
  if (w !== h) warnings.push(`Not square: ${w}×${h}.`);
  if (w > MAX_DIM || h > MAX_DIM) warnings.push(`Larger than ${MAX_DIM}×${MAX_DIM}: ${w}×${h}.`);
  return warnings;
}

/** Validate config; returns an error string or null. */
export function configProblem(cfg) {
  if (!cfg.owner || !cfg.repo) return "GitHub owner and repo are not set.";
  if (!cfg.token) return "No GitHub token saved.";
  if (!cfg.branch) return "Branch is not set.";
  return null;
}

/** Turn a GitHub API failure into a clear message. Never includes the token. */
export function describeGithubError(status, body, headers) {
  const msg = body && typeof body.message === "string" ? body.message : "";
  const get = (k) => (headers && typeof headers.get === "function" ? headers.get(k) : null);
  switch (status) {
    case 401:
      return "GitHub rejected the token (401). It is wrong, expired or revoked. Create a new one and paste it in the options page.";
    case 403: {
      if (get("x-ratelimit-remaining") === "0" || /rate limit/i.test(msg)) {
        const reset = get("x-ratelimit-reset");
        const when = reset ? ` Resets around ${new Date(Number(reset) * 1000).toLocaleTimeString()}.` : "";
        return `GitHub rate limit hit (403).${when}`;
      }
      return `GitHub denied access (403). The token needs "Contents: Read and write" on this repo.${msg ? " GitHub says: " + msg : ""}`;
    }
    case 404:
      return "Not found (404). Check owner, repo and branch in the options. Fine-grained tokens also return 404 when the token has no access to the repo.";
    case 409:
      return `Conflict (409): the file changed while uploading. Try again.${msg ? " " + msg : ""}`;
    case 422:
      return `GitHub rejected the request (422).${msg ? " " + msg : ""} (Is the branch name right? Did the file change since it was checked?)`;
    case 429:
      return "GitHub rate limit hit (429). Wait a minute and try again.";
    default:
      return `GitHub error ${status}.${msg ? " " + msg : ""}`;
  }
}
