// Thin GitHub Contents API client. fetchFn is injectable for tests.
import { describeGithubError, encodePath } from "./lib.js";

const API = "https://api.github.com";

export class GithubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function call(fetchFn, url, init) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new GithubError("Network error: couldn't reach api.github.com. Check your connection.", 0);
  }
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON body */ }
  return { res, body };
}

function contentsUrl(cfg, path) {
  return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encodePath(path)}`;
}

/** Resolves {exists:false} or {exists:true, sha}. */
export async function getExisting(cfg, path, fetchFn = fetch) {
  const url = `${contentsUrl(cfg, path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const { res, body } = await call(fetchFn, url, { headers: headers(cfg.token), cache: "no-store" });
  if (res.status === 200) {
    if (Array.isArray(body) || !body || !body.sha) {
      throw new GithubError(`"${path}" is a folder in the repo, not a file.`, 200);
    }
    return { exists: true, sha: body.sha };
  }
  if (res.status === 404) return { exists: false };
  throw new GithubError(describeGithubError(res.status, body, res.headers), res.status);
}

/** Creates or (with sha) overwrites a file. Resolves the API response body. */
export async function putFile(cfg, path, base64, message, sha, fetchFn = fetch) {
  const payload = { message, content: base64, branch: cfg.branch };
  if (sha) payload.sha = sha;
  const { res, body } = await call(fetchFn, contentsUrl(cfg, path), {
    method: "PUT",
    headers: { ...headers(cfg.token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 200 || res.status === 201) return body;
  throw new GithubError(describeGithubError(res.status, body, res.headers), res.status);
}

/** Throws a clear error if the branch doesn't exist. */
export async function checkBranch(cfg, fetchFn = fetch) {
  const url = `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/branches/${encodePath(cfg.branch)}`;
  const { res, body } = await call(fetchFn, url, { headers: headers(cfg.token), cache: "no-store" });
  if (res.status === 200) return;
  if (res.status === 404) throw new GithubError(`Branch "${cfg.branch}" doesn't exist in ${cfg.owner}/${cfg.repo}. Check the repo's default branch (often "main" or "master").`, 404);
  throw new GithubError(describeGithubError(res.status, body, res.headers), res.status);
}

/** For the options page "Test connection" button. */
export async function checkRepo(cfg, fetchFn = fetch) {
  const url = `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const { res, body } = await call(fetchFn, url, { headers: headers(cfg.token), cache: "no-store" });
  if (res.status === 200) return body;
  throw new GithubError(describeGithubError(res.status, body, res.headers), res.status);
}
