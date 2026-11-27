import assert from "node:assert/strict";

import { chromium } from "playwright";

import { startPreview } from "../src/site/preview-server.ts";

// A copy lands asynchronously, and waitForFunction resolves at once on a returned promise,
// so poll the clipboard from the test until accept passes; after 30s throw with the last
// text read and the last read rejection, so a permission or focus failure shows its cause.
export async function readClipboardUntil(page, accept) {
  let text = "";
  let rejection;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
    const read = await page.evaluate(() =>
      navigator.clipboard.readText().then(
        (value) => ({ value }),
        (error) => ({ error: String(error) }),
      ),
    );
    if ("error" in read) rejection = read.error;
    else if (accept((text = read.value))) return text;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `the clipboard never held the expected text in 30s; last read ${JSON.stringify(text.slice(0, 200))}` +
      (rejection ? `, last read rejection: ${rejection}` : ""),
  );
}

export async function clipboardEquals(page, expected) {
  assert.equal(await readClipboardUntil(page, (text) => text === expected), expected);
}

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
