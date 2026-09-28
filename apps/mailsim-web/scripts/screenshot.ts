/**
 * Screenshots the inbox. Build it and run a sink serving it first, then run
 * this with that base URL, the id of an HTML message and of a text-only one.
 * PNGs land in `.claude/tmp/screens/mailsim-web/`.
 */
import { resolve } from "node:path";

import { captureScreens, type ScreenView } from "@langwatch/design-system-internal/screenshot";

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

/* The inbox holds a long poll open, so it never reaches network idle: wait for load and live. */
const written = await captureScreens({
  baseUrl,
  views,
  outDir,
  waitUntil: "load",
  ready: '.mail-status .ds-dot[data-state="live"]',
});
process.stdout.write(`${written.length} screenshots in ${outDir}\n`);
