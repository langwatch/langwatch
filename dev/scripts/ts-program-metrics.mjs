#!/usr/bin/env node
// Type-check cost of every TypeScript program in the workspace, one JSON line each.
// Walks the root solution's references, checks each config alone with --noEmit,
// --extendedDiagnostics and --generateTrace, and keeps only the summary. Reads
// referenced packages' built declarations, so run it after `pnpm typecheck`.
// Plan: dev/docs/plans/typescript-cpu-and-check-time.md.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const outFile =
  args.find((arg) => arg.startsWith("--out="))?.slice(6) ??
  join(root, ".claude/tmp/ts-program-metrics.jsonl");
const only = args.filter((arg) => !arg.startsWith("--")).map((path) => resolve(path));
const tsc = join(root, "node_modules/.bin/tsc");

const readConfig = (file) =>
  JSON.parse(
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1"),
  );
const configOf = (path) => {
  if (!existsSync(path)) return path;
  const directory = statSync(path).isDirectory();
  return directory ? join(path, "tsconfig.json") : path;
};

/** Every config reachable from the root solution that compiles files (containers skipped). */
function programs() {
  const seen = new Set();
  const found = [];
  const walk = (file) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const config = readConfig(file);
    for (const reference of config.references ?? [])
      walk(configOf(resolve(dirname(file), reference.path)));
    const container =
      Array.isArray(config.files) &&
      config.files.length === 0 &&
      (config.include ?? []).length === 0;
    if (!container && file !== join(root, "tsconfig.json")) found.push(file);
  };
  walk(join(root, "tsconfig.json"));
  return found;
}

const DIAGNOSTICS = [
  "Files",
  "Lines",
  "Types",
  "Instantiations",
  "Memory used",
  "Parse time",
  "Check time",
  "Total time",
];
const SKIP = new Set([
  "findSourceFile",
  "parseJsonSourceFileConfigFileContent",
  "processRootFiles",
  "createProgram",
]);

/** Self time (event minus its children) by event name and by source file, from a trace. */
function selfTimes(traceFile) {
  const byThread = new Map();
  for (const event of JSON.parse(readFileSync(traceFile, "utf8"))) {
    if (event.ph !== "X" || SKIP.has(event.name)) continue;
    if (!byThread.has(event.tid)) byThread.set(event.tid, []);
    byThread.get(event.tid).push({ ...event, child: 0 });
  }
  const totals = { byName: {}, byFile: {} };
  for (const events of byThread.values()) addThreadSelfTimes({ events, totals });
  return totals;
}

/** One thread's events, nested by time: each parent's `child` collects its children's durations. */
function addThreadSelfTimes({ events, totals }) {
  const ordered = events.toSorted((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const stack = [];
  for (const event of ordered) {
    while (stack.length > 0 && stack.at(-1).ts + (stack.at(-1).dur ?? 0) <= event.ts) stack.pop();
    if (stack.length > 0) stack.at(-1).child += event.dur ?? 0;
    stack.push(event);
  }
  for (const event of ordered) {
    const ms = ((event.dur ?? 0) - event.child) / 1000;
    totals.byName[event.name] = (totals.byName[event.name] ?? 0) + ms;
    const path = event.args?.path;
    if (typeof path !== "string") continue;
    const file = relative(root, path);
    totals.byFile[file] = (totals.byFile[file] ?? 0) + ms;
  }
}

/** Our own generics (outside node_modules) by number of instantiated types. */
function ownGenerics(typesFile) {
  const counts = {};
  for (const type of JSON.parse(readFileSync(typesFile, "utf8"))) {
    const name = type.aliasSymbolName ?? type.symbolName;
    const path = type.firstDeclaration?.path ?? "";
    if (!name || path.includes("node_modules")) continue;
    if (!("aliasTypeArguments" in type || "typeArguments" in type || "instantiatedType" in type))
      continue;
    const key = `${name} ${relative(root.toLowerCase(), path.toLowerCase())}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const top = (record, count) =>
  Object.entries(record)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key, value]) => [key, Math.round(value)]);

const targets = only.length > 0 ? only : programs();
writeFileSync(outFile, "");
for (const [index, file] of targets.entries()) {
  const scratch = mkdtempSync(join(tmpdir(), "ts-metrics-"));
  const row = { config: relative(root, file) };
  try {
    let output;
    try {
      output = execFileSync(
        tsc,
        [
          "-p",
          file,
          "--noEmit",
          "--extendedDiagnostics",
          "--generateTrace",
          scratch,
          "--tsBuildInfoFile",
          join(scratch, "b.tsbuildinfo"),
        ],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 256 * 1024 * 1024,
          env: {
            ...process.env,
            GOMAXPROCS: process.env.GOMAXPROCS ?? "2",
            GOMEMLIMIT: process.env.GOMEMLIMIT ?? "3GiB",
          },
        },
      );
    } catch (error) {
      output = `${error.stdout ?? ""}`;
      row.errors = (output.match(/error TS\d+/g) ?? []).length;
    }
    for (const name of DIAGNOSTICS) {
      const match = output.match(new RegExp(`^${name}:\\s+([\\d.]+)`, "m"));
      if (match)
        row[
          name.replace(/ (\w)/, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toLowerCase())
        ] = Number(match[1]);
    }
    const traceFile = join(scratch, "trace.json");
    if (existsSync(traceFile)) {
      const { byName, byFile } = selfTimes(traceFile);
      row.selfMs = Object.fromEntries(top(byName, 6));
      row.hotFiles = top(byFile, 5);
    }
    const typesFile = readdirSync(scratch).find((name) => name.startsWith("types"));
    if (typesFile) row.hotGenerics = top(ownGenerics(join(scratch, typesFile)), 5);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  writeFileSync(outFile, `${JSON.stringify(row)}\n`, { flag: "a" });
  process.stderr.write(
    `${index + 1}/${targets.length} ${row.config} ${row.instantiations ?? "?"}\n`,
  );
}
