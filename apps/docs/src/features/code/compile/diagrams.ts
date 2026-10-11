import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { Mermaid } from "mermaid";
import { chromium, type Browser, type Page } from "playwright";
import { z } from "zod";

import { cacheRoot, publicRoot } from "../../../paths.ts";
import { diagramTheme } from "./diagram-theme.ts";

const require = createRequire(import.meta.url);
const mermaidRoot = path.dirname(require.resolve("mermaid/package.json"));
const cacheDir = path.join(cacheRoot, "docs-diagrams");
const diagramSchema = z.object({ light: z.string(), dark: z.string() });
export type Diagram = z.infer<typeof diagramSchema>;
let browser: Browser | undefined;
let page: Page | undefined;
let queue: Promise<unknown> = Promise.resolve();

declare global {
  interface Window {
    diagramRenderer: Mermaid;
  }
}

/** One headless Chromium page with Mermaid and the reading font, shared by every diagram. */
async function renderer() {
  if (page) return page;
  browser = await chromium.launch();
  const target = await browser.newPage();
  page = target;
  await target.route("http://diagrams.local/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<html><head><style>@font-face{font-family:Inter;src:url(/font.woff2);font-weight:100 900}body{font-family:Inter}</style></head><body><script type="module">import mermaid from "/dist/mermaid.esm.min.mjs"; window.diagramRenderer = mermaid;</script></body></html>',
      });
    if (pathname === "/font.woff2") {
      return route.fulfill({
        contentType: "font/woff2",
        body: await readFile(path.join(publicRoot, "fonts/Inter-Variable-latin.woff2")),
      });
    }
    const file = path.resolve(mermaidRoot, `.${pathname}`);
    if (!file.startsWith(mermaidRoot + path.sep)) return route.abort();
    await route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
  });
  await target.goto("http://diagrams.local/");
  await target.waitForFunction(() => Boolean(window.diagramRenderer));
  await target.evaluate(() => document.fonts.load("16px Inter"));
  return target;
}

/** Light and dark SVG for one Mermaid source, cached on disk by source and palette. */
export function renderDiagram({ source }: { source: string }): Promise<Diagram> {
  const job = queue.then(async () => {
    const hash = createHash("sha256")
      .update("intrinsic-font-v2" + source + JSON.stringify(diagramTheme))
      .digest("hex")
      .slice(0, 16);
    const file = path.join(cacheDir, `${hash}.json`);
    try {
      return diagramSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch {
      // Render a missing or stale cache entry.
    }
    const target = await renderer();
    const renderedSource = source.startsWith("sequenceDiagram")
      ? source
          .split("\n")
          .map((line) => {
            const colon = line.indexOf(":");
            if (colon < 0) return line;
            return line.slice(0, colon + 1) + line.slice(colon + 1).replaceAll(";", "#59;");
          })
          .join("\n")
      : source;
    const result = { light: "", dark: "" };
    for (const mode of ["light", "dark"] as const) {
      result[mode] = await target.evaluate(
        async ({ source, mode, hash, palette }) => {
          window.diagramRenderer.initialize({
            startOnLoad: false,
            theme: "base",
            themeVariables: palette,
            securityLevel: "strict",
            fontFamily: "Inter, sans-serif",
            htmlLabels: false,
            flowchart: { htmlLabels: false, curve: "basis" },
          });
          const { svg } = await window.diagramRenderer.render(`diagram-${mode}-${hash}`, source);
          const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1].split(/\s+/).map(Number);
          return viewBox ? svg.replace('width="100%"', `width="${viewBox[2]}"`) : svg;
        },
        { source: renderedSource, mode, hash, palette: diagramTheme[mode] },
      );
    }
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(result));
    return result;
  });
  queue = job.catch(() => {});
  return job;
}

export async function closeDiagrams() {
  await queue;
  await browser?.close();
  page = void 0;
  browser = void 0;
}
