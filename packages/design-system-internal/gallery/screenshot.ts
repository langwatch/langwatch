/**
 * Screenshots the gallery. Start it first (`pnpm --filter
 * @langwatch/design-system-internal dev`), then run this with an optional
 * base URL. PNGs land in `.claude/tmp/screens/kit/` at the repository root.
 */
import { resolve } from "node:path";

import { captureScreens, type ScreenView } from "./capture.ts";

const baseUrl = process.argv[2] ?? "http://localhost:5571";
const outDir = resolve(import.meta.dirname, "../../../.claude/tmp/screens/kit");

const views: ScreenView[] = [
  { name: "overview", path: "/" },
  { name: "case", path: "/?pane=single", each: "[data-screen]" },
  {
    name: "focus",
    path: "/?pane=single",
    each: '[data-screen="buttons"]',
    prepare: async ({ page }) => {
      await page.locator('[data-screen="buttons"] h2').click();
      await page.keyboard.press("Tab");
    },
  },
  {
    name: "armed",
    path: "/?pane=single",
    each: '[data-screen="buttons"]',
    prepare: async ({ page }) => {
      await page.getByRole("button", { name: "Stop" }).click();
    },
  },
  {
    name: "dialog",
    path: "/?pane=single",
    viewportOnly: true,
    prepare: async ({ page }) => {
      await page.getByRole("button", { name: "Open dialog" }).click();
    },
  },
];

const written = await captureScreens({ baseUrl, views, outDir });
process.stdout.write(`${written.length} screenshots in ${outDir}\n`);
