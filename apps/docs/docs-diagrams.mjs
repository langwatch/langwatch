import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { chromium } from "playwright";

import { diagramTheme } from "./diagram-theme.mjs";

const require = createRequire(import.meta.url);
const mermaidRoot = path.dirname(require.resolve("mermaid/package.json"));
const cache = new URL("./node_modules/.cache/docs-diagrams/", import.meta.url);
let browser;
let page;
let queue = Promise.resolve();

async function renderer() {
  if (page) return page;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.route("http://diagrams.local/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<html><head><style>@font-face{font-family:Inter;src:url(/font.woff2);font-weight:100 900}body{font-family:Inter}</style></head><body><script type="module">import mermaid from "/dist/mermaid.esm.min.mjs"; window.diagramRenderer = mermaid;</script></body></html>',
      });
    if (pathname === "/font.woff2") {
      return route.fulfill({
        contentType: "font/woff2",
        body: await readFile(new URL("./public/fonts/Inter-Variable-latin.woff2", import.meta.url)),
      });
    }
    const file = path.resolve(mermaidRoot, `.${pathname}`);
    if (!file.startsWith(mermaidRoot + path.sep)) return route.abort();
    await route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
  });
  await page.goto("http://diagrams.local/");
  await page.waitForFunction(() => Boolean(window.diagramRenderer));
  await page.evaluate(() => document.fonts.load("16px Inter"));
  return page;
}

export function renderDiagram({ source }) {
  const job = queue.then(async () => {
    const hash = createHash("sha256")
      .update("intrinsic-font-v2" + source + JSON.stringify(diagramTheme))
      .digest("hex")
      .slice(0, 16);
    const file = new URL(`${hash}.json`, cache);
    try {
      return JSON.parse(await readFile(file, "utf8"));
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
    const result = {};
    for (const mode of ["light", "dark"]) {
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
    await mkdir(cache, { recursive: true });
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
