import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Page } from "playwright";

export type ColourScheme = "light" | "dark";

export type ScreenView = {
  /** Becomes the file name: `<name>-<width>-<scheme>.png`. */
  name: string;
  /** Joined to `baseUrl`, e.g. "/" or "/?pane=single". */
  path: string;
  /** Runs after load and fonts, before the capture: open a dialog, press Tab. */
  prepare?: (input: { page: Page }) => Promise<void>;
  /** One PNG per match instead of the page, named `<name>-<data-screen>-...`. */
  each?: string;
  /** Capture the viewport only; the default is the full page. */
  viewportOnly?: boolean;
};

export type CaptureScreensInput = {
  /** A running dev or preview server; this builds nothing. */
  baseUrl: string;
  views: ScreenView[];
  outDir: string;
  widths?: number[];
  schemes?: ColourScheme[];
  /** `load` for a page holding a long poll, which never reaches network idle. */
  waitUntil?: "load" | "networkidle";
  /** A selector each page waits for (visible) before `prepare`, e.g. its heading or first row. */
  ready?: string;
};

const HEIGHT = 900;

const captureEach = async ({
  page,
  view,
  suffix,
  outDir,
}: {
  page: Page;
  view: ScreenView & { each: string };
  suffix: string;
  outDir: string;
}) => {
  const written: string[] = [];
  const matches = await page.locator(view.each).all();
  for (const [index, match] of matches.entries()) {
    const key = (await match.getAttribute("data-screen")) ?? String(index);
    const file = join(outDir, `${view.name}-${key}-${suffix}.png`);
    // Clipped from the full page, never scrolled to, so a sticky head sits where it lays out.
    const box = await match.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
    });
    await page.screenshot({ path: file, fullPage: true, clip: box, animations: "disabled" });
    written.push(file);
  }
  return written;
};

const captureView = async ({
  page,
  view,
  suffix,
  outDir,
}: {
  page: Page;
  view: ScreenView;
  suffix: string;
  outDir: string;
}) => {
  await view.prepare?.({ page });
  if (view.each !== undefined) {
    return captureEach({ page, view: { ...view, each: view.each }, suffix, outDir });
  }
  const file = join(outDir, `${view.name}-${suffix}.png`);
  await page.screenshot({ path: file, fullPage: !view.viewportOnly, animations: "disabled" });
  return [file];
};

/**
 * Screenshots each view at each width in each colour scheme, through the
 * system `prefers-color-scheme`, and answers the files written. Consoles call
 * it from their own `scripts/screenshot.ts` against their built bundle.
 */
export const captureScreens = async ({
  baseUrl,
  views,
  outDir,
  widths = [1280, 390],
  schemes = ["light", "dark"],
  waitUntil = "networkidle",
  ready,
}: CaptureScreensInput): Promise<string[]> => {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const written: string[] = [];
  try {
    for (const scheme of schemes) {
      for (const width of widths) {
        const context = await browser.newContext({
          viewport: { width, height: HEIGHT },
          colorScheme: scheme,
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        for (const view of views) {
          await page.goto(new URL(view.path, baseUrl).toString(), { waitUntil });
          if (ready !== undefined) await page.locator(ready).first().waitFor();
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          written.push(
            ...(await captureView({ page, view, suffix: `${width}-${scheme}`, outDir })),
          );
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return written;
};
