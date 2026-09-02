#!/usr/bin/env node
/**
 * Seeds the 8 "Legacy: *" parity widgets into a project's custom-chart
 * playground via the REST API, so the golden set can be recreated (or
 * refreshed after editing the JSON files here) without opening the UI.
 *
 * Auth and target project are read from the environment because this script
 * is meant to run against any LangWatch deployment, not just one hardcoded
 * project. See `app.dashboard-widgets.v1.ts` for the endpoint contract.
 *
 * Env vars:
 *   LW_ENDPOINT  Base URL of the LangWatch app, e.g. https://app.langwatch.ai
 *   LW_API_KEY   Project API key, sent as the X-Auth-Token header
 *   PROJECT_ID   Target project id (path parameter)
 *
 * Usage:
 *   LW_ENDPOINT=https://app.langwatch.ai LW_API_KEY=sk-... PROJECT_ID=proj_... \
 *     node platform/app/scripts/legacy-parity-widgets/seed.mjs
 *
 * Idempotent-ish: before creating a widget, the script lists existing
 * widgets and skips any whose name already matches — re-running does not
 * duplicate widgets, but it also does not update ones that were edited
 * on the platform since the last seed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const widgetsUrl = `${endpoint}/api/v1/projects/${projectId}/analytics/dashboard-widgets`;

function loadWidgetDefinitions() {
  const files = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(__dirname, file), "utf8");
    const definition = JSON.parse(raw);
    return { file, definition };
  });
}

async function listExistingNames() {
  const res = await fetch(widgetsUrl, {
    method: "GET",
    headers: { "X-Auth-Token": apiKey },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to list existing widgets: ${res.status} ${await res.text()}`,
    );
  }
  const body = await res.json();
  return new Set((body.data ?? []).map((w) => w.name));
}

async function createWidget(definition) {
  const res = await fetch(widgetsUrl, {
    method: "POST",
    headers: {
      "X-Auth-Token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: definition.name,
      code: definition.code,
      queries: definition.queries,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to create widget "${definition.name}": ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

async function main() {
  const widgets = loadWidgetDefinitions();
  const existingNames = await listExistingNames();

  for (const { file, definition } of widgets) {
    if (existingNames.has(definition.name)) {
      console.log(`skip  ${file} — "${definition.name}" already exists`);
      continue;
    }
    const created = await createWidget(definition);
    console.log(`create ${file} — "${definition.name}" -> ${created.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
