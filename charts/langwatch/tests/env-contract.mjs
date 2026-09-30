#!/usr/bin/env node
// Static env contract for the app, workers and migrate containers: every variable the chart
// sets is one some process reads, and every variable a process refuses to boot without is set.
// Usage (from charts/langwatch, after `helm dependency build .`):
//   node tests/env-contract.mjs          check the default, minimal and full values sets
//   node tests/env-contract.mjs --map    print every variable a process reads, with its owners
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const chart = join(import.meta.dirname, "..");
const root = join(chart, "../..");

const SCAN = [
  "modules",
  "enterprise/modules",
  "packages",
  "apps/api/src",
  "apps/worker/src",
  "apps/tasks/src",
];
const SKIP_DIR =
  /^(node_modules|dist|__tests__|tests|browser|e2e|scripts|oxlint-rules|architecture-enforcer|generated)$/;

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIR.test(name)) yield* sources(path);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec|stories)\.tsx?$/.test(name)) yield path;
  }
}

const NAME_PATTERNS = [
  /[^\w.]c\.env\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /Secret\.load\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /(?:process\.env|[^\w.](?:environment|source|env))(?:\.|\[\s*")([A-Z][A-Z0-9_]+)/g,
];

/** The names one source file reads: config leaves, secret handles, direct reads and name lists. */
function namesIn(file, text) {
  const names = NAME_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[1]));
  for (const m of text.matchAll(
    /[A-Z_]*(?:VARIABLES|ENV_NAMES)\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]/g,
  )) {
    names.push(...[...m[1].matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((n) => n[1]));
  }
  if (!file.includes("feature-flag/contract")) return names;
  const flags = text.matchAll(/(?:legacyEnvVar|key):\s*"([a-z][a-z0-9_-]+|[A-Z][A-Z0-9_]+)"/g);
  return [...names, ...[...flags].map((m) => m[1].toUpperCase().replace(/-/g, "_"))];
}

/** Every name a process reads, with its owners, and the prefixes a secret family answers. */
function declarations() {
  const found = new Map();
  const prefixes = new Map();
  for (const file of SCAN.flatMap((top) => [...sources(join(root, top))])) {
    const text = readFileSync(file, "utf8");
    for (const name of namesIn(file, text)) {
      found.set(name, (found.get(name) ?? new Set()).add(relative(root, file)));
    }
    for (const m of text.matchAll(/ENV_PREFIX\s*=\s*"([A-Z0-9_]+)"/g)) {
      prefixes.set(m[1], relative(root, file));
    }
  }
  return { found, prefixes };
}

// Read by Node, the OTel SDK or the AWS SDK rather than by a declaration.
const RUNTIME = new Set([
  "NODE_ENV",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "UV_THREADPOOL_SIZE",
  "TZ",
  "HOME",
  "OTEL_SERVICE_NAME",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_TRACES_SAMPLER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_TRACES_EXPORTER",
  "OTEL_PROPAGATORS",
  "AWS_REGION",
  "AWS_ROLE_ARN",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_STS_REGIONAL_ENDPOINTS",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]);

// Every declaration is optional; these are what a process refuses or degrades without.
const STORES = ["DATABASE_URL", "REDIS_URL", "CLICKHOUSE_URL"];
const SERVING = [...STORES, "NEXTAUTH_SECRET", "CREDENTIALS_SECRET", "NEXTAUTH_URL", "BASE_HOST"];
const REQUIRED = { app: SERVING, workers: SERVING, migrate: STORES };

// Template, and the name of the process container inside it (release "lw").
const PROCESS_CONTAINERS = {
  app: ["templates/app/deployment.yaml", "lw-app"],
  workers: ["templates/workers/deployment.yaml", "lw-workers"],
  migrate: ["templates/app/migrate-pre-roll-job.yaml", "migrate"],
};

/**
 * The env names one container is given, and the names its values interpolate. Read from
 * the rendered lines rather than a YAML parser, so the check needs nothing but helm and node.
 */
function renderedEnv(args, [template, container]) {
  const out = execFileSync("helm", ["template", "lw", chart, ...args, "--show-only", template], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${container}`);
  const envAt = lines.findIndex((l, i) => i > start && l.trim() === "env:");
  if (start < 0 || envAt < 0) return null;
  const indent = lines[envAt].search(/\S/);
  const names = new Set();
  const interpolated = new Set();
  for (const line of lines.slice(envAt + 1)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (line.search(/\S/) <= indent) break;
    const name = line.match(new RegExp(`^ {${indent + 2}}- name: "?([A-Za-z0-9_]+)"?$`))?.[1];
    if (name) names.add(name);
    for (const m of line.matchAll(/\$\(([A-Z0-9_]+)\)/g)) interpolated.add(m[1]);
  }
  return { names, interpolated };
}

const VALUE_SETS = {
  default: ["--set", "autogen.enabled=true"],
  minimal: [
    "-f",
    join(chart, "examples/overlays/size-minimal.yaml"),
    "--set",
    "autogen.enabled=true",
  ],
  full: ["-f", join(chart, "tests/values-e2e-full.yaml"), "--set", "autogen.enabled=true"],
  // SSO, a forced flag and an operator variable: the branches parity is easiest to lose on.
  sso: [
    "--set",
    "autogen.enabled=true",
    "--set",
    "app.nextAuth.provider=oidc",
    "--set",
    "app.nextAuth.providers.oidc.clientId.value=placeholder-client",
    "--set",
    "app.nextAuth.providers.oidc.issuer.value=https://issuer.example.com",
    "--set",
    "app.nextAuth.providers.oidc.clientSecret.value=placeholder-secret",
    "--set",
    "app.featureFlagForceEnable=release_example",
    "--set",
    "app.extraEnvs[0].name=LOG_FORMAT",
    "--set",
    "app.extraEnvs[0].value=json",
  ],
};

/** What is wrong with one values set, as one message per problem. */
// The workers get everything the app gets except its port (Alex, 2026-09-30).
const APP_ONLY = new Set(["API_PORT"]);

/** Names one side sets and the other does not, as parity problems. */
function parityProblems(set, app, workers) {
  const missing = [...app.names].filter((n) => !APP_ONLY.has(n) && !workers.names.has(n));
  const extra = [...workers.names].filter((n) => !app.names.has(n));
  return [
    ...missing.map((n) => `[${set}] workers: does not set ${n}, which the app gets`),
    ...extra.map((n) => `[${set}] workers: sets ${n}, which the app does not get`),
  ];
}

/** What is wrong with one values set, as one message per problem. */
function problemsIn(set, args, isRead) {
  const problems = [];
  const envs = {};
  for (const [container, where] of Object.entries(PROCESS_CONTAINERS)) {
    const env = renderedEnv(args, where);
    if (!env) {
      problems.push(`[${set}] ${container}: not rendered`);
      continue;
    }
    envs[container] = env;
    const unread = [...env.names].filter((n) => !isRead(n) && !env.interpolated.has(n));
    const missing = REQUIRED[container].filter((n) => !env.names.has(n));
    problems.push(
      ...unread.map((n) => `[${set}] ${container}: sets ${n}, which no process reads`),
      ...missing.map((n) => `[${set}] ${container}: does not set ${n}`),
    );
  }
  if (envs.app && envs.workers) problems.push(...parityProblems(set, envs.app, envs.workers));
  return problems;
}

function main() {
  const { found, prefixes } = declarations();
  if (process.argv.includes("--map")) {
    for (const [name, owners] of [...found].toSorted()) {
      console.log(`${name}\t${[...owners].join(", ")}`);
    }
    for (const [prefix, owner] of prefixes) console.log(`${prefix}*\t${owner}`);
    return;
  }
  const isRead = (name) =>
    found.has(name) || RUNTIME.has(name) || [...prefixes.keys()].some((p) => name.startsWith(p));
  const problems = Object.entries(VALUE_SETS).flatMap(([set, args]) => {
    const setProblems = problemsIn(set, args, isRead);
    if (setProblems.length === 0) console.log(`ok   [${set}] app, workers and migrate`);
    return setProblems;
  });
  for (const problem of problems) console.log(`FAIL ${problem}`);
  if (problems.length > 0) {
    console.log(`${problems.length} failure(s)`);
    process.exit(1);
  }
  console.log("env contract holds");
}

main();
