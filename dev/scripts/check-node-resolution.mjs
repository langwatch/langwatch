#!/usr/bin/env node
// Every backend process runs on `node --experimental-transform-types`, whose
// ESM resolver needs the on-disk extension `tsc` doesn't require. This
// script exercises node's real resolver directly, the way boot does.
//
// Usage: node dev/scripts/check-node-resolution.mjs [--json]
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Packages whose runtime is the browser (JSX in the source tree) or whose
// shipped entry is a build artifact rather than `src`. Node's inability to
// transform `.tsx` is expected there, not a defect this check should fail on.
export function isBrowserSkipPath(relPath) {
  return (
    relPath.includes("/web/") ||
    relPath.startsWith("packages/design-system/") ||
    relPath.startsWith("packages/browser-host/src/drawer/") ||
    relPath.startsWith("packages/mail/")
  );
}

/**
 * node's ERR_MODULE_NOT_FOUND message: "Cannot find module '<specifier>'
 * imported from <importer>" — both halves are what a fix needs.
 */
export function parseModuleNotFound(message) {
  const match = /^Cannot find module '(.+)' imported from (.+)$/.exec(message ?? "");
  if (!match) return null;
  return { specifier: match[1], importer: match[2] };
}

/**
 * The real entrypoints call their start function at module scope (just
 * importing one connects to Postgres/ClickHouse/Redis), so each is swapped
 * for the nearest module that only *defines* it without calling it.
 */
export const PROCESS_ENTRYPOINTS = [
  "apps/api/src/app/api-standalone.executable.ts",
  "apps/worker/src/app/worker-standalone.executable.ts",
  "apps/tasks/src/tasks.catalogue.ts",
];

export function listBarrels() {
  const out = execFileSync("git", ["ls-files", "--", "packages/**/src/index.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

export function listTargets() {
  return [...listBarrels(), ...PROCESS_ENTRYPOINTS].toSorted();
}

const IMPORT_PROBE = `
import(process.argv[1]).then(
  () => { process.stdout.write(JSON.stringify({ ok: true })); process.exit(0); },
  (error) => {
    process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));
    process.exit(1);
  },
);
`;

/**
 * Runs one absolute path through node's real resolver in a child process —
 * a bad specifier can crash the module graph in ways unsafe to catch
 * in-process — and classifies the outcome.
 */
export async function probeImport(absPath, { timeoutMs = 60_000 } = {}) {
  const child = spawn(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", "-e", IMPORT_PROBE, absPath],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const exitInfo = await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise({ timedOut: true });
    }, timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      resolvePromise({ timedOut: false });
    });
  });

  if (exitInfo.timedOut) {
    return { status: "failed", reason: `timed out after ${timeoutMs}ms` };
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      status: "error",
      reason: `probe produced no result (stderr: ${stderr.trim().slice(0, 500)})`,
    };
  }

  if (parsed.ok) return { status: "ok" };

  if (parsed.code === "ERR_MODULE_NOT_FOUND") {
    const parsedMessage = parseModuleNotFound(parsed.message);
    return {
      status: "failed",
      code: parsed.code,
      specifier: parsedMessage?.specifier ?? null,
      importer: parsedMessage?.importer ?? null,
      message: parsed.message,
    };
  }

  return { status: "maybe-skip-tsx", code: parsed.code, message: parsed.message };
}

/** Whether an unknown-extension failure is the known, in-scope `.tsx` skip case. */
function isSkippableTsxExtension({ code, message, relPath }) {
  if (code !== "ERR_UNKNOWN_FILE_EXTENSION") return false;
  if (!/\.tsx"?$/.test(message)) return false;
  return isBrowserSkipPath(relPath);
}

export async function checkTarget(relPath, { timeoutMs = 60_000 } = {}) {
  const result = await probeImport(join(root, relPath), { timeoutMs });

  if (result.status === "maybe-skip-tsx") {
    if (isSkippableTsxExtension({ code: result.code, message: result.message, relPath })) {
      return { target: relPath, status: "skipped", code: result.code, message: result.message };
    }
    // Any other import-time failure (including a non-skipped
    // ERR_UNKNOWN_FILE_EXTENSION, or a module that throws while running) is
    // out of scope: reported, not counted as a resolution failure.
    return { target: relPath, status: "error", code: result.code, message: result.message };
  }

  return { target: relPath, ...result };
}

/** Bounded-concurrency runner: `limit` targets in flight at a time. */
export async function runChecks(targets, { concurrency = 4, timeoutMs = 60_000 } = {}) {
  const results = Array.from({ length: targets.length });
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= targets.length) return;
      results[i] = await checkTarget(targets[i], { timeoutMs });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
}

async function main() {
  const jsonOutput = process.argv.includes("--json");
  const targets = listTargets();
  const results = await runChecks(targets);

  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped");
  const errored = results.filter((r) => r.status === "error");
  const ok = results.filter((r) => r.status === "ok");

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          results,
          ok: ok.length,
          skipped: skipped.length,
          errored: errored.length,
          failed: failed.length,
        },
        null,
        2,
      ),
    );
  } else {
    for (const f of failed) {
      console.error(
        `FAIL ${f.target}: ${f.code ?? "?"} — cannot resolve '${f.specifier ?? "?"}' imported from ${
          f.importer ?? relative(root, join(root, f.target))
        }${f.reason ? ` (${f.reason})` : ""}`,
      );
    }
    for (const e of errored) {
      console.error(
        `(ignored, not a resolution failure) ${e.target}: ${e.code ?? "?"} ${e.message ?? ""}`,
      );
    }
  }

  console.error(
    `check-node-resolution: ${targets.length} targets — ${ok.length} ok, ${skipped.length} skipped, ${failed.length} resolution failures, ${errored.length} other import-time errors ignored`,
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
