# Send to Icons Repo

Chrome/Edge (Manifest V3) extension. Right-click any image → **Send to icons repo** → pick a filename → it is committed to your GitHub repo and the public URL is copied to your clipboard.

Plain JavaScript, no build step, no dependencies.

## 1. Create the fine-grained token

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** your account.
3. **Expiration:** your choice (the extension tells you when GitHub says the token is rejected).
4. **Repository access:** *Only select repositories* → pick just your icons repo.
5. **Repository permissions:** **Contents → Read and write**. (Metadata: read is added automatically.) Nothing else.
6. Generate, and copy the token (starts with `github_pat_`). You only see it once.

## 2. Load the extension (Windows, Chrome or Edge)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right in Chrome; left sidebar in Edge).
3. Click **Load unpacked** and select this `icons-extension` folder.
4. The options page opens on its own the first time you use the menu; you can also click **Details → Extension options**.
5. Fill in owner, repo, branch, folder, paste the token, and press **Save**, then **Test connection**.

The token field is a password box and is never shown again after saving. Leave it blank to keep the saved token, or use **Remove saved token**.

## 3. Test it

1. Right-click any image on any web page → **Send to icons repo**.
2. A small window shows a preview, the dimensions, and a pre-filled filename (lowercase, hyphens, extension matched to the real image type, so PNGs are always `.png`).
3. If the image is not square or is larger than 600×600, a yellow warning appears and the button reads **Upload anyway**.
4. Click Upload. On success the public URL is copied and a notification shows it.
5. Upload the same filename again to see the **Overwrite / Cancel** prompt.
6. Failure checks: save a wrong token (expect "rejected the token"), or a wrong repo name (expect "Not found (404)").

Unit tests for the pure logic (filename sanitizing, base64, data URLs, dimension rules, GitHub client with a mocked `fetch`, error messages): `npm test` (needs Node 20+, only for the tests, not for the extension).

## Permissions, and why

| Permission | Why |
|---|---|
| `contextMenus` | Adds the right-click item on images. |
| `storage` | Saves your settings (`storage.local`) and passes the image to the upload window (`storage.session`, cleared when the window closes). |
| `notifications` | Shows the success URL and any errors. |
| `clipboardWrite` | Copies the final URL after upload. |
| host `https://api.github.com/*` | Calls the GitHub Contents API. |
| host `<all_urls>` | Lets the background worker download an image from any site without CORS blocking it. (It technically covers api.github.com too; that entry is kept to make the intent explicit.) |

## Notes

- **Token handling:** stored in `chrome.storage.local` (unencrypted on disk, as with any extension). It is only sent to `api.github.com`, never logged, and never shown in errors.
- **jsDelivr caching:** `@main` URLs are cached by jsDelivr for up to about 12 hours, so a *replaced* file may show the old image for a while. New filenames are available almost immediately. To force a refresh, request `https://purge.jsdelivr.net/gh/USER/REPO@main/icons/NAME.png`.
- **Switching to Cloudflare Pages / Netlify:** just change **Public URL base** in options; the filename is appended to it.
- **Size limit:** images over 5 MB are refused.
- **Files:** `background.js` (menu + image fetch), `prompt.html/js` (filename, warnings, overwrite, upload, clipboard), `options.html/js`, `lib.js` (pure helpers), `github.js` (API client).
