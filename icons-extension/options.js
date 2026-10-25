import { DEFAULT_CONFIG, defaultPublicBase, normalizeFolder } from "./lib.js";
import { checkRepo } from "./github.js";

const $ = (id) => document.getElementById(id);
const FIELDS = ["owner", "repo", "branch", "folder", "publicBase"];
let savedToken = "";

function status(kind, text) {
  const el = $("status");
  el.hidden = !text;
  el.className = `box ${kind}`;
  el.textContent = text || "";
}

function readForm() {
  const v = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  v.folder = normalizeFolder(v.folder);
  v.token = $("token").value.trim() || savedToken; // blank field = keep the saved token
  return v;
}

function refreshPlaceholder() {
  const f = readForm();
  $("publicBase").placeholder = defaultPublicBase({
    owner: f.owner || "USERNAME", repo: f.repo || "REPO", branch: f.branch || "main", folder: f.folder,
  });
}

function refreshTokenState() {
  $("token-state").textContent = savedToken
    ? "A token is saved (hidden). Leave this blank to keep it, or paste a new one to replace it."
    : "No token saved yet.";
  $("clear-token").hidden = !savedToken;
}

function validate(v) {
  if (!/^[A-Za-z0-9_.-]+$/.test(v.owner)) return "Owner is required (letters, numbers, - _ .).";
  if (!/^[A-Za-z0-9_.-]+$/.test(v.repo)) return "Repo is required (letters, numbers, - _ .).";
  if (!v.branch || /\s/.test(v.branch)) return "Branch is required and can't contain spaces.";
  if (!v.token) return "Paste your fine-grained token.";
  if (v.publicBase && !/^https?:\/\//i.test(v.publicBase)) return "Public URL base must start with http:// or https://.";
  return null;
}

async function load() {
  const { config } = await chrome.storage.local.get("config");
  const c = { ...DEFAULT_CONFIG, ...(config || {}) };
  for (const f of FIELDS) $(f).value = c[f];
  savedToken = c.token;
  refreshTokenState();
  refreshPlaceholder();
}

$("save").addEventListener("click", async () => {
  const v = readForm();
  const problem = validate(v);
  if (problem) return status("err", problem);
  await chrome.storage.local.set({ config: v });
  savedToken = v.token;
  $("token").value = "";
  $("folder").value = v.folder;
  refreshTokenState();
  status("ok", "Saved.");
});

$("test").addEventListener("click", async () => {
  const v = readForm();
  const problem = validate(v);
  if (problem) return status("err", problem);
  status("", "Testing…");
  try {
    const repo = await checkRepo(v);
    status("ok", `Connected to ${repo.full_name} (${repo.private ? "private" : "public"}). Write access is only confirmed on the first upload.`);
  } catch (err) {
    status("err", err.message);
  }
});

$("clear-token").addEventListener("click", async () => {
  const { config } = await chrome.storage.local.get("config");
  await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, ...(config || {}), token: "" } });
  savedToken = "";
  refreshTokenState();
  status("ok", "Token removed.");
});

for (const f of FIELDS) $(f).addEventListener("input", refreshPlaceholder);
load();
