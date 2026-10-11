import assert from "node:assert/strict";

import { chromium } from "playwright";

import { startPreview } from "./preview-server.mjs";

export async function withPreviewBrowser({ outDir, run }) {
  const server = await startPreview({ outDir, port: 0 });
  let browser;
  try {
    browser = await chromium.launch();
    await run({ browser, base: server.resolvedUrls.local[0] });
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
}

export async function withReader({ outDir, run }) {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
        permissions: ["clipboard-read", "clipboard-write"],
      });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await run({ page, browser, base });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    },
  });
}
