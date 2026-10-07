import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1427",
    viewport: { width: 1100, height: 760 },
    launchOptions: { executablePath: process.env.ORGANIC_TEST_BROWSER || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 1427 --strictPort", url: "http://127.0.0.1:1427", reuseExistingServer: false },
});
