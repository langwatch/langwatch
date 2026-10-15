#!/usr/bin/env node
/**
 * Captures the dashboard template preview images: each template's board, drawn by the running
 * app from preview-only sample data, light and dark. How to run it: README.md beside this file.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DAYS, PREVIEW_NOW, SAMPLES } from "./sample-data.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { chromium } = createRequire(path.join(REPO_ROOT, "apps/ui/package.json"))("playwright");

const APP = process.env.LANGWATCH_URL ?? "http://localhost:5560";
const API = process.env.LANGWATCH_API_URL ?? "http://localhost:6560";
const OUT_DIR = path.join(REPO_ROOT, "apps/ui/public/images/dashboards/templates");
const AUTH_STATE = path.join(os.tmpdir(), "langwatch-template-previews-auth.json");
const DASHBOARDS_SRC = "/modules/analytics/browser/src/features/dashboards";
const THEMES = ["light", "dark"];

// The board is laid out at this width and cropped with a margin to the card's 2.36 ratio, so
// the first row of widgets reads at card size (about 0.45 scale) without the page header.
const GRID_WIDTH = 736;
const MARGIN = 12;
const CROP = { width: GRID_WIDTH + 2 * MARGIN, height: 322 };
const WEBP_QUALITY = 0.8;
const QUIET_MS = 2500;

const fail = (message) => {
  console.error(`template-previews: ${message}`);
  process.exit(1);
};

async function signedInContext(browser) {
  if (fs.existsSync(AUTH_STATE)) {
    const context = await browser.newContext({ storageState: AUTH_STATE });
    const session = await (await context.request.get(`${APP}/api/auth/get-session`)).json();
    if (session) return context;
    await context.close();
  }
  const { PREVIEW_EMAIL: email, PREVIEW_PASSWORD: password } = process.env;
  if (!email || !password) fail("set PREVIEW_EMAIL and PREVIEW_PASSWORD to sign in once");
  const context = await browser.newContext();
  const response = await context.request.post(`${APP}/api/auth/sign-in/email`, {
    data: { email, password },
    headers: { origin: API },
  });
  if (!response.ok()) fail(`sign-in answered ${response.status()}`);
  await context.storageState({ path: AUTH_STATE });
  return context;
}

async function projectSlug(context) {
  if (process.env.PREVIEW_PROJECT) return process.env.PREVIEW_PROJECT;
  const input = encodeURIComponent("{}");
  const response = await context.request.get(`${APP}/api/trpc/organization.getAll?input=${input}`);
  const organizations = (await response.json()).result?.data ?? [];
  const slug = organizations.flatMap(({ teams }) => teams.flatMap(({ projects }) => projects))[0]
    ?.slug;
  return slug ?? fail("no project to open; set PREVIEW_PROJECT");
}

/** The templates and the captured ids, read through the app's own Vite server: no TS runner. */
async function loadCatalogue(page) {
  const src = `/@fs${REPO_ROOT}${DASHBOARDS_SRC}`;
  await page.addScriptTag({
    type: "module",
    content: `
      import { BOARD_TEMPLATES } from "${src}/templates/index.ts";
      import { TEMPLATE_PREVIEW_IDS } from "${src}/model/template-library.ts";
      window.__templatePreviews = JSON.stringify({
        templates: BOARD_TEMPLATES,
        previewIds: [...TEMPLATE_PREVIEW_IDS],
      });`,
  });
  await page.waitForFunction(() => window.__templatePreviews, null, { timeout: 60_000 });
  return JSON.parse(await page.evaluate(() => window.__templatePreviews));
}

const queryKeys = (template) =>
  template.widgets.flatMap((widget) =>
    widget.definition.queries.map((query) => ({ key: `${widget.key}/${query.name}`, query })),
  );

function columnType(value) {
  if (typeof value === "number") return Number.isInteger(value) ? "UInt64" : "Float64";
  if (typeof value === "boolean") return "Bool";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(String(value))) return "DateTime";
  return "Nullable(String)";
}

/** One sample as the query transport answers it: complete, every day bucket present. */
function resultOf(sample) {
  const { rows, completeness } = Array.isArray(sample) ? { rows: sample } : sample;
  const bucketed = rows.some((row) => "bucket" in row);
  const buckets = DAYS.map((day) => ({ start: `${day.replace(" ", "T")}Z`, n: 1 }));
  return {
    columns: Object.entries(rows[0] ?? {}).map(([name, value]) => ({
      name,
      type: columnType(value),
    })),
    rows,
    statistics: { elapsedMs: 12, rowsRead: rows.length, bytesRead: 0, rowsReturned: rows.length },
    diagnostics: [],
    followsTimeWindow: true,
    followsGranularity: bucketed,
    ...(bucketed ? { granularitySeconds: 86_400 } : {}),
    completeness: {
      state: "complete",
      unit: "traces",
      total: 1000,
      fields: [],
      ...(bucketed ? { buckets } : {}),
      ...completeness,
    },
  };
}

const answer = (route, data) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });

const boardIdOf = (template) => `template-preview-${template.id}`;

/**
 * Answers the board reads with one board per template and every widget query from its sample,
 * so moving between boards needs no reload. Notes when the last query was answered.
 */
function routeBoards({ context, templates, stage }) {
  const samples = new Map(
    templates.flatMap((template) =>
      queryKeys(template).map(({ key, query }) => [query.sql, SAMPLES[key]]),
    ),
  );
  const boards = templates.map((template) => ({
    id: boardIdOf(template),
    name: template.name,
    order: 0,
    description: template.description,
    createdById: null,
    createdAt: PREVIEW_NOW,
    updatedAt: PREVIEW_NOW,
    _count: { graphs: template.widgets.length },
    isStarred: false,
  }));
  const widgets = templates.flatMap((template) =>
    template.widgets.map(({ key, name, definition, layout }) => ({
      id: `${boardIdOf(template)}-${key}`,
      dashboardId: boardIdOf(template),
      name,
      graph: definition,
      ...layout,
    })),
  );
  return context.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/api/trpc/")[1];
    if (procedure === "dashboards.getAll") return answer(route, boards);
    if (procedure === "dashboardWidgets.list") return answer(route, widgets);
    if (procedure !== "analytics.lwql.query") return route.fallback();
    const { sql } = route.request().postDataJSON();
    const sample = samples.get(sql);
    if (!sample) {
      stage.unanswered.add(sql.slice(0, 80));
      return route.fulfill({ status: 500, body: "no preview sample for this query" });
    }
    stage.lastAnswerAt = Date.now();
    return answer(route, resultOf(sample));
  });
}

async function fitGrid(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { width } = await page.locator(".chart-grid").boundingBox();
    if (Math.round(width) === GRID_WIDTH) return;
    const viewport = page.viewportSize();
    await page.setViewportSize({ ...viewport, width: viewport.width + GRID_WIDTH - width });
    await page.waitForTimeout(500);
  }
  throw new Error(`the board grid did not settle at ${GRID_WIDTH}px`);
}

/** Opens a board in the running app; the old grid is marked so only the new one is waited on. */
async function openBoard({ page, url, reload }) {
  if (reload) {
    await page.goto(url);
  } else {
    await page.evaluate((href) => {
      for (const grid of document.querySelectorAll(".chart-grid")) grid.dataset.previewOld = "";
      history.pushState(history.state, "", href);
      dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    }, url);
  }
  await page.locator(".chart-grid:not([data-preview-old])").waitFor({ timeout: 60_000 });
}

/** Waits until every widget has its rows and every chart frame has stopped resizing. */
async function settle({ page, stage, widgets }) {
  const items = page.locator(".chart-grid-item");
  await items.nth(widgets - 1).waitFor({ timeout: 60_000 });
  const drawn = await items.count();
  if (drawn !== widgets) throw new Error(`drew ${drawn} of ${widgets} widgets`);
  let heights = "";
  for (let stable = 0; stable < 4;) {
    await page.waitForTimeout(250);
    const now = await page.$$eval("iframe", (frames) => frames.map((f) => f.style.height).join());
    stable = now === heights && Date.now() - stage.lastAnswerAt > QUIET_MS ? stable + 1 : 0;
    heights = now;
  }
}

async function failedWidgets(page) {
  const faces = '[data-testid="widget-state-face"], [data-testid="frame-diagnostic-badge"]';
  return page
    .locator(".chart-grid-item")
    .filter({ has: page.locator(faces) })
    .allInnerTexts();
}

/** PNG to WebP in the browser's own encoder, so the script needs no image library. */
async function toWebp({ page, png }) {
  const base64 = await page.evaluate(
    async ({ data, quality }) => {
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/webp", quality });
      if (blob.type !== "image/webp") throw new Error(`encoded ${blob.type}, not WebP`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { data: `data:image/png;base64,${png.toString("base64")}`, quality: WEBP_QUALITY },
  );
  return Buffer.from(base64, "base64");
}

async function captureBoard({ page, stage, template, theme, url, reload }) {
  stage.unanswered.clear();
  stage.lastAnswerAt = Date.now();
  await openBoard({ page, url, reload });
  await fitGrid(page);
  await page.mouse.move(0, 0);
  await settle({ page, stage, widgets: template.widgets.length });
  const failed = await failedWidgets(page);
  if (failed.length > 0 || stage.unanswered.size > 0) {
    fail(`${template.id} (${theme}): ${[...failed, ...stage.unanswered].join(" | ")}`);
  }
  const grid = await page.locator(".chart-grid:not([data-preview-old])").boundingBox();
  const png = await page.screenshot({ clip: { x: grid.x - MARGIN, y: grid.y - MARGIN, ...CROP } });
  const file = path.join(OUT_DIR, theme, `${template.id}.webp`);
  fs.writeFileSync(file, await toWebp({ page, png }));
  console.log(`${theme} ${template.id} ${fs.statSync(file).size} B`);
}

async function captureTheme({ browser, auth, slug, theme, templates }) {
  const context = await browser.newContext({
    storageState: auth,
    colorScheme: theme,
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(PREVIEW_NOW));
  const stage = { unanswered: new Set(), lastAnswerAt: 0 };
  await routeBoards({ context, templates, stage });
  fs.mkdirSync(path.join(OUT_DIR, theme), { recursive: true });

  let reload = true;
  for (const template of templates) {
    const url = `${APP}/${slug}/dashboards/${boardIdOf(template)}?range=30d`;
    try {
      await captureBoard({ page, stage, template, theme, url, reload });
    } catch (error) {
      // The shared dev server restarts on file changes; one fresh load rides that out.
      console.warn(`${theme} ${template.id}: ${error.message.split("\n")[0]}; reloading`);
      await captureBoard({ page, stage, template, theme, url, reload: true });
    }
    reload = false;
  }
  await context.close();
}

const browser = await chromium.launch();
try {
  const context = await signedInContext(browser);
  const slug = await projectSlug(context);
  const auth = await context.storageState();
  const page = await context.newPage();
  await page.goto(`${APP}/${slug}/dashboards`);
  const { templates, previewIds } = await loadCatalogue(page);
  await context.close();

  const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : previewIds;
  const chosen = ids.map(
    (id) => templates.find((template) => template.id === id) ?? fail(`no template ${id}`),
  );
  const missing = chosen.flatMap((template) =>
    queryKeys(template)
      .filter(({ key }) => !(key in SAMPLES))
      .map(({ key }) => `${template.id}/${key}`),
  );
  if (missing.length > 0) fail(`no sample in sample-data.mjs for:\n  ${missing.join("\n  ")}`);

  for (const theme of THEMES) {
    await captureTheme({ browser, auth, slug, theme, templates: chosen });
  }
} finally {
  await browser.close();
}
