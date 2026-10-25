import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeBaseName, sanitizeFilename, suggestFilename, parseDataUrl, bytesToBase64, base64ToBytes,
  sniffMime, normalizeFolder, buildPublicUrl, checkImageShape, describeGithubError, encodePath,
} from "../lib.js";
import { getExisting, putFile, GithubError } from "../github.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test("sanitizeBaseName", () => {
  assert.equal(sanitizeBaseName("My Cool  Icon_v2"), "my-cool-icon-v2");
  assert.equal(sanitizeBaseName("Café Ünïcode"), "cafe-unicode");
  assert.equal(sanitizeBaseName("../../etc/passwd"), "etc-passwd");
  assert.equal(sanitizeBaseName("***"), "icon");
  assert.equal(sanitizeBaseName(""), "icon");
});

test("sanitizeFilename forces extension from the real type", () => {
  assert.equal(sanitizeFilename("Logo Final.JPG", "image/png"), "logo-final.png");
  assert.equal(sanitizeFilename("logo", "image/png"), "logo.png");
  assert.equal(sanitizeFilename("logo.png", "image/jpeg"), "logo.jpg");
  assert.equal(sanitizeFilename("a/b\\c.png", "image/png"), "a-b-c.png");
  assert.equal(sanitizeFilename("thing.svg", null), "thing.svg");
  assert.equal(sanitizeFilename("thing", null), "thing.png");
});

test("suggestFilename from URLs", () => {
  assert.equal(suggestFilename("https://example.com/assets/My%20Icon@2x.png?v=3#x", "image/png"), "my-icon-2x.png");
  assert.equal(suggestFilename("https://example.com/", "image/webp"), "icon.webp");
  assert.equal(suggestFilename("data:image/png;base64,AAAA", "image/png"), "icon.png");
  assert.equal(suggestFilename("not a url", "image/png"), "icon.png");
});

test("base64 round trip, including large inputs", () => {
  assert.equal(bytesToBase64(PNG), Buffer.from(PNG).toString("base64"));
  const big = new Uint8Array(200000).map((_, i) => (i * 31) % 256);
  const b64 = bytesToBase64(big);
  assert.equal(b64, Buffer.from(big).toString("base64"));
  assert.deepEqual(base64ToBytes(b64), big);
});

test("data URLs", () => {
  const b64 = Buffer.from(PNG).toString("base64");
  const p = parseDataUrl(`data:image/png;base64,${b64}`);
  assert.equal(p.mime, "image/png");
  assert.deepEqual(p.bytes, PNG);
  const svg = parseDataUrl("data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22x%22%3E%3C%2Fsvg%3E");
  assert.equal(new TextDecoder().decode(svg.bytes), '<svg xmlns="x"></svg>');
  assert.equal(sniffMime(svg.bytes), "image/svg+xml");
  assert.throws(() => parseDataUrl("https://x"));
});

test("sniffMime", () => {
  assert.equal(sniffMime(PNG), "image/png");
  assert.equal(sniffMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffMime(new TextEncoder().encode("<!doctype html><html>")), null);
});

test("folder, public URL, path encoding", () => {
  assert.equal(normalizeFolder("icons"), "icons/");
  assert.equal(normalizeFolder("/a//b/"), "a/b/");
  assert.equal(normalizeFolder(""), "");
  assert.equal(encodePath("icons/my file#1.png"), "icons/my%20file%231.png");
  const cfg = { owner: "me", repo: "r", branch: "main", folder: "icons/", publicBase: "" };
  assert.equal(buildPublicUrl(cfg, "a.png"), "https://cdn.jsdelivr.net/gh/me/r@main/icons/a.png");
  assert.equal(buildPublicUrl({ ...cfg, publicBase: "https://x.pages.dev/icons" }, "a.png"), "https://x.pages.dev/icons/a.png");
});

test("dimension warnings", () => {
  assert.deepEqual(checkImageShape(512, 512), []);
  assert.deepEqual(checkImageShape(600, 600), []);
  assert.equal(checkImageShape(800, 800).length, 1);
  assert.equal(checkImageShape(400, 300).length, 1);
  assert.equal(checkImageShape(1200, 600).length, 2);
  assert.equal(checkImageShape(0, 0).length, 1);
});

test("error messages", () => {
  assert.match(describeGithubError(401, {}, null), /token/);
  assert.match(describeGithubError(404, {}, null), /404/);
  assert.match(describeGithubError(422, { message: "Branch xyz not found" }, null), /Branch xyz/);
  const h = new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" });
  assert.match(describeGithubError(403, {}, h), /rate limit/i);
  assert.match(describeGithubError(403, {}, new Headers()), /Contents/);
});

function mockFetch(responses, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  };
}

test("github client: exists / not exists / put", async () => {
  const cfg = { owner: "me", repo: "r", branch: "main", token: "SECRET-TOKEN" };
  const calls = [];
  const f = mockFetch([{ status: 200, body: { sha: "abc" } }, { status: 404 }, { status: 201, body: { ok: 1 } }], calls);
  assert.deepEqual(await getExisting(cfg, "icons/a b.png", f), { exists: true, sha: "abc" });
  assert.deepEqual(await getExisting(cfg, "icons/new.png", f), { exists: false });
  assert.equal(calls[0].url, "https://api.github.com/repos/me/r/contents/icons/a%20b.png?ref=main");
  assert.equal(calls[0].init.headers.Authorization, "Bearer SECRET-TOKEN");

  await putFile(cfg, "icons/new.png", "QUJD", "Add icon: new.png", "abc", f);
  const sent = JSON.parse(calls[2].init.body);
  assert.deepEqual(sent, { message: "Add icon: new.png", content: "QUJD", branch: "main", sha: "abc" });
  assert.equal(calls[2].init.method, "PUT");
});

test("github client: errors never leak the token", async () => {
  const cfg = { owner: "me", repo: "r", branch: "main", token: "SECRET-TOKEN" };
  for (const status of [401, 403, 404, 422, 500]) {
    await assert.rejects(putFile(cfg, "icons/a.png", "QQ==", "m", null, mockFetch([{ status, body: { message: "boom" } }], [])),
      (e) => e instanceof GithubError && e.status === status && !e.message.includes("SECRET-TOKEN"));
  }
  await assert.rejects(getExisting(cfg, "icons/a.png", mockFetch([new TypeError("fail")], [])), /Network error/);
});
