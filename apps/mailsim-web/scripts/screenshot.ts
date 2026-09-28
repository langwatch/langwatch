/**
 * Screenshots the inbox. Build it and run a sink serving it first, then run
 * this with that base URL, the id of an HTML message and of a text-only one.
 * PNGs land in `.claude/tmp/screens/mailsim-web/`.
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ScreenView } from "@langwatch/design-system-internal/screenshot";
import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5580";
const htmlMessageId = process.argv[3];
const textMessageId = process.argv[4];
const outDir = resolve(import.meta.dirname, "../../../.claude/tmp/screens/mailsim-web");

const views: ScreenView[] = [
  { name: "inbox", path: "/" },
  {
    name: "filtered-empty",
    path: "/",
    prepare: async ({ page }) => {
      await page.getByRole("searchbox", { name: "Search inbox" }).fill("no such message");
    },
  },
  {
    name: "focus",
    path: "/",
    viewportOnly: true,
    prepare: async ({ page }) => {
      await page.getByRole("searchbox", { name: "Search inbox" }).focus();
      await page.keyboard.press("Tab");
    },
  },
];
if (htmlMessageId !== undefined) {
  views.push(
    {
      name: "message-preview",
      path: `/messages/${htmlMessageId}`,
      prepare: async ({ page }) => {
        await page.frameLocator("iframe").locator("body *").first().waitFor();
      },
    },
    {
      name: "message-source",
      path: `/messages/${htmlMessageId}`,
      prepare: async ({ page }) => {
        await page.getByRole("tab", { name: "HTML source" }).click();
      },
    },
    {
      name: "message-headers",
      path: `/messages/${htmlMessageId}`,
      prepare: async ({ page }) => {
        await page.getByRole("tab", { name: /Headers/u }).click();
      },
    },
    {
      name: "delete-armed",
      path: `/messages/${htmlMessageId}`,
      viewportOnly: true,
      prepare: async ({ page }) => {
        await page.getByRole("button", { name: "Delete" }).click();
      },
    },
  );
}
if (textMessageId !== undefined) {
  views.push({ name: "message-text", path: `/messages/${textMessageId}` });
}
views.push({ name: "missing", path: "/messages/does-not-exist" });

/**
 * The kit's captureScreens waits for network idle, which the inbox never
 * reaches: it keeps a long poll open for new mail. This is the same loop,
 * waiting for the page's heading instead (handoff: shared-file request).
 */
const capture = async () => {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  let count = 0;
  try {
    for (const scheme of ["light", "dark"] as const) {
      for (const width of [1280, 390]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: scheme,
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        for (const view of views) {
          await page.goto(new URL(view.path, baseUrl).toString(), { waitUntil: "load" });
          await page.getByRole("heading", { name: "Inbox", level: 1 }).waitFor();
          await page.waitForTimeout(400);
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          await view.prepare?.({ page });
          await page.waitForTimeout(150);
          await page.screenshot({
            path: join(outDir, `${view.name}-${width}-${scheme}.png`),
            fullPage: !view.viewportOnly,
            animations: "disabled",
          });
          count += 1;
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return count;
};

const written = await capture();
process.stdout.write(`${written} screenshots in ${outDir}\n`);
