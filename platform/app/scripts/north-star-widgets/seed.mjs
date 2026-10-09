#!/usr/bin/env node
// @ts-nocheck
/**
 * North-star: seeds the 10 "North-star: *" widgets into a project's
 * custom-chart playground via the REST API, so the golden set can be
 * recreated (or refreshed after editing the JSON files here) without
 * opening the UI.
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
 *     node platform/app/scripts/north-star-widgets/seed.mjs
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

/**
 * Refuses a credential-bearing endpoint that would send LW_API_KEY in
 * cleartext (CWE-319): https is required, and http is allowed only for a
 * loopback host where nothing leaves the machine.
 */
function assertSecureEndpoint(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`Invalid LW_ENDPOINT URL: ${raw}`);
    process.exit(1);
  }
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const httpsOrLoopbackHttp =
    url.protocol === "https:" ||
    (url.protocol === "http:" && loopback.has(url.hostname));
  if (!httpsOrLoopbackHttp) {
    console.error(
      `Refusing to send LW_API_KEY over ${url.protocol} to ${url.host}. Use https:// (http:// is allowed only for localhost).`,
    );
    process.exit(1);
  }
}

const endpoint = requireEnv("LW_ENDPOINT").replace(/\/+$/, "");
assertSecureEndpoint(endpoint);
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
    // A cross-origin redirect would forward X-Auth-Token to the new host
    // (undici does not strip custom auth headers), so fail loudly instead.
    redirect: "error",
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
    redirect: "error",
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
