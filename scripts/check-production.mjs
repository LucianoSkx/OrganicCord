import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const path = resolve("dist", `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
  if (!path.startsWith(resolve("dist") + "/") && !path.startsWith(resolve("dist") + "\\")) { response.writeHead(403).end(); return; }
  try { response.setHeader("content-type", types[extname(path)] ?? "application/octet-stream"); response.end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise((ready) => server.listen(1432, "127.0.0.1", ready));
const browser = await chromium.launch({ executablePath: process.env.ORGANIC_TEST_BROWSER ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.stack));
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    let id = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++id, unregisterCallback: () => {},
      invoke: async (command) => {
        if (command === "list_accounts") return [];
        if (command === "plugin:store|load") return 1;
        if (command === "plugin:store|get") return null;
        if (command === "plugin:event|listen") return id;
        if (command === "game_detection_scan") return null;
        if (command === "discord_rpc_get_settings") return { enabled: false, applicationId: "" };
        return undefined;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  await page.goto("http://127.0.0.1:1432");
  await page.waitForTimeout(3000);
  const emojiLoadedOnStartup = requests.some((url) => /\/emoji-picker-/.test(url));
  console.log(JSON.stringify({ pageErrors: errors, rendered: (await page.locator("#root").textContent()).length > 0, buttons: await page.getByRole("button").count(), emojiLoadedOnStartup }));
  if (errors.length || emojiLoadedOnStartup || !(await page.locator("#root").textContent())?.length) process.exitCode = 1;
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
