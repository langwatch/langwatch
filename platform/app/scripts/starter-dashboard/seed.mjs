#!/usr/bin/env node
/**
 * Starter dashboard: one-shot populates an "Analytics starter" dashboard
 * with 8 widgets pulled from the north-star-widgets and legacy-parity-widgets
 * packs, in a fixed order (order = vertical layout order).
 *
 * This does NOT replace the pack seeders — it reuses their env contract and
 * fetch style, but pins pre-existing (or newly created) dashboard widgets
 * onto a dashboard. Pinning does NOT move a widget: the widget's dashboardId
 * is set so it renders on the dashboard, but it stays visible and editable
 * on the playground too. See README.md.
 *
 * Env vars:
 *   LW_ENDPOINT  Base URL of the LangWatch app, e.g. https://app.langwatch.ai
 *   LW_API_KEY   Project API key, sent as the X-Auth-Token header
 *   PROJECT_ID   Target project id (path parameter for widget routes only —
 *                dashboard routes resolve the project from LW_API_KEY)
 *
 * Usage:
 *   LW_ENDPOINT=https://app.langwatch.ai LW_API_KEY=sk-... PROJECT_ID=proj_... \
 *     node platform/app/scripts/starter-dashboard/seed.mjs
 *
 * Idempotent: re-running skips the dashboard (name match), skips widgets
 * that already exist (name match), and skips pins already on this
 * dashboard (dashboardId match) — no duplicates.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(__dirname, "..");

const DASHBOARD_NAME = "Analytics starter";

// Order IS the layout: pins land at the target dashboard's next free row,
// single column, in this order.
const MANIFEST = [
  { pack: "north-star-widgets", file: "north-star-metric-stat.json" },
  { pack: "north-star-widgets", file: "north-star-area-timeseries.json" },
  { pack: "north-star-widgets", file: "north-star-stacked-bars.json" },
  { pack: "legacy-parity-widgets", file: "legacy-trace-count-over-time.json" },
  { pack: "north-star-widgets", file: "north-star-donut.json" },
  { pack: "north-star-widgets", file: "north-star-leaderboard.json" },
  { pack: "north-star-widgets", file: "north-star-heatmap.json" },
  { pack: "legacy-parity-widgets", file: "legacy-latency-percentiles.json" },
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

const endpoint = requireEnv("LW_ENDPOINT").replace(/\/+$/, "");
const apiKey = requireEnv("LW_API_KEY");
const projectId = requireEnv("PROJECT_ID");

const dashboardsUrl = `${endpoint}/api/dashboards`;
const widgetsUrl = `${endpoint}/api/v1/projects/${projectId}/analytics/dashboard-widgets`;

async function getJson(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-Auth-Token": apiKey },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-Token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Resolve + parse every manifest file up front; fail loud before any write. */
function loadManifestDefinitions() {
  return MANIFEST.map(({ pack, file }) => {
    const filePath = path.join(scriptsDir, pack, file);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing manifest file: ${pack}/${file}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const definition = JSON.parse(raw);
    return { pack, file, definition };
  });
}

async function ensureDashboard() {
  const { data } = await getJson(dashboardsUrl);
  const existing = data.find((d) => d.name === DASHBOARD_NAME);
  if (existing) {
    console.log(`skip   dashboard — "${DASHBOARD_NAME}" already exists`);
    return existing;
  }
  const created = await postJson(dashboardsUrl, { name: DASHBOARD_NAME });
  console.log(`create dashboard — "${DASHBOARD_NAME}" -> ${created.id}`);
  return created;
}

async function ensureWidgets(items) {
  const { data } = await getJson(widgetsUrl);
  const existingByName = new Map(data.map((w) => [w.name, w]));

  const results = [];
  for (const { pack, file, definition } of items) {
    const existing = existingByName.get(definition.name);
    if (existing) {
      console.log(`skip   ${pack}/${file} — "${definition.name}" already exists`);
      results.push(existing);
      continue;
    }
    const created = await postJson(widgetsUrl, {
      name: definition.name,
      code: definition.code,
      queries: definition.queries,
    });
    console.log(`create ${pack}/${file} — "${definition.name}" -> ${created.id}`);
    results.push(created);
  }
  return results;
}

async function pinWidgets(widgets, dashboard) {
  for (const widget of widgets) {
    if (widget.dashboardId === dashboard.id) {
      console.log(`skip   pin — "${widget.name}" already on dashboard`);
      continue;
    }
    await postJson(`${widgetsUrl}/${widget.id}/dashboard`, {
      dashboardId: dashboard.id,
    });
    console.log(`pin    "${widget.name}" -> ${dashboard.id}`);
  }
}

async function main() {
  const manifestItems = loadManifestDefinitions();

  const dashboard = await ensureDashboard();
  const widgets = await ensureWidgets(manifestItems);
  await pinWidgets(widgets, dashboard);

  const openUrl =
    dashboard.platformUrl ??
    `${endpoint}/analytics/reports?dashboard=${dashboard.id}`;
  console.log(`Done. Open ${openUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
