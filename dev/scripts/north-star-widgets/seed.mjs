#!/usr/bin/env node
// @ts-nocheck

/**
 * North-star: seeds the 10 "North-star: *" widgets via the REST API (see
 * `app.dashboard-widgets.v1.ts`). Idempotent-ish: skips widgets whose name
 * already matches, but does not update ones edited since the last seed.
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
 * Refuses any LW_ENDPOINT but a local host: this is a fixture seed for a dev stack, never for a
 * real installation (the check legacy-parity-widgets/seed-demo-traffic.mjs already makes).
 */
function assertLocalEndpoint(raw) {
  let hostname;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    console.error(`Refusing to seed: LW_ENDPOINT is not a valid URL (${raw}).`);
    process.exit(1);
  }
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = ["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".localhost");
  if (!local) {
    console.error(
      `Refusing to seed: LW_ENDPOINT host "${hostname}" is not local. ` +
        "This fixture seed only targets localhost, 127.0.0.1, ::1 or *.localhost.",
    );
    process.exit(1);
  }
}

const endpoint = requireEnv("LW_ENDPOINT").replace(/\/+$/, "");
assertLocalEndpoint(endpoint);
const apiKey = requireEnv("LW_API_KEY");
const projectId = requireEnv("PROJECT_ID");

const widgetsUrl = `${endpoint}/api/v1/projects/${projectId}/analytics/dashboard-widgets`;

function loadWidgetDefinitions() {
  const files = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith(".json"))
    .toSorted();
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
    throw new Error(`Failed to list existing widgets: ${res.status} ${await res.text()}`);
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
