#!/usr/bin/env node
// Type-check cost of every TypeScript program in the workspace, one JSON line each: each
// config checked alone with tsgo's --extendedDiagnostics and --generateTrace, the trace kept
// only as its hot spots. Run it after `pnpm typecheck`. tsgo's trace format and why it is
// read this way: dev/docs/nightly-suite.md. Plan: dev/docs/plans/typescript-cpu-and-check-time.md.
// Spec: specs/tooling/codebase-health.feature.
import { execFileSync } from "node:child_process";
import {
  createReadStream,
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
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const HOT_SPOTS = 10;

const DIAGNOSTICS = [
  "Files",
  "Lines",
  "Symbols",
  "Types",
  "Instantiations",
  "Memory used",
  "Parse time",
  "Bind time",
  "Check time",
  "Total time",
];
const SELF_TIME_SKIP = new Set([
  "findSourceFile",
  "parseJsonSourceFileConfigFileContent",
  "processRootFiles",
  "createProgram",
]);
const RELATION = "structuredTypeRelatedTo";
const TIMED_EVENT = /"ph":"[BEX]"/;

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
function programs({ root }) {
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

/** `Memory used: 62595K` becomes `memoryUsed: 62595`; the numbers keep the compiler's units. */
export function parseDiagnostics({ output }) {
  const row = {};
  for (const name of DIAGNOSTICS) {
    const match = output.match(new RegExp(`^${name}:\\s+([\\d.]+)`, "m"));
    if (match)
      row[name.replace(/ (\w)/, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toLowerCase())] =
        Number(match[1]);
  }
  return row;
}

/**
 * A path relative to the root; tsgo lower-cases paths on a case-insensitive file
 * system. A dependency's path is cut to what follows its last node_modules/.
 */
export function relativeTo({ root, path }) {
  const dependency = path.lastIndexOf("/node_modules/");
  if (dependency !== -1) return path.slice(dependency + 1);
  if (path.startsWith(root)) return relative(root, path);
  const [lowerRoot, lowerPath] = [root.toLowerCase(), path.toLowerCase()];
  if (lowerPath.startsWith(lowerRoot)) return relative(lowerRoot, lowerPath);
  return path;
}

/** One trace line as an event, or null for the brackets and blank lines around them. */
export function parseTraceLine({ line }) {
  const text = line.trim().replace(/,$/, "");
  if (!text.startsWith("{")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Complete events (ts, dur) from B/E pairs and X events, per thread. */
function completeEvents({ events }) {
  const open = new Map();
  const byThread = new Map();
  const add = (tid, event) => {
    if (!byThread.has(tid)) byThread.set(tid, []);
    byThread.get(tid).push(event);
  };
  for (const event of events) {
    if (event.ph === "X") add(event.tid, { ...event, dur: event.dur ?? 0 });
    else if (event.ph === "B") {
      if (!open.has(event.tid)) open.set(event.tid, []);
      open.get(event.tid).push(event);
    } else if (event.ph === "E") {
      const stack = open.get(event.tid) ?? [];
      const at = stack.findLastIndex((item) => item.name === event.name);
      if (at === -1) continue;
      const [begin] = stack.splice(at, 1);
      add(event.tid, { ...begin, ph: "X", dur: event.ts - begin.ts });
    }
  }
  return byThread;
}

/** Each event's own time on its thread, its children's subtracted, summed by name. */
function selfTimeByName({ byThread }) {
  const totals = {};
  for (const events of byThread.values()) {
    const ordered = events
      .filter((event) => !SELF_TIME_SKIP.has(event.name))
      .map((event) => ({ ...event, child: 0 }))
      .toSorted((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    for (const event of ordered) {
      while (stack.length > 0 && stack.at(-1).ts + stack.at(-1).dur <= event.ts) stack.pop();
      if (stack.length > 0) stack.at(-1).child += event.dur;
      stack.push(event);
    }
    for (const event of ordered)
      totals[event.name] = (totals[event.name] ?? 0) + (event.dur - event.child) / 1000;
  }
  return totals;
}

/** Relations not nested inside another relation on the same thread: the comparisons that cost. */
function outermostRelations({ byThread }) {
  const found = [];
  for (const events of byThread.values()) {
    let end = -Infinity;
    const relations = events
      .filter((event) => event.name === RELATION)
      .toSorted((a, b) => a.ts - b.ts || b.dur - a.dur);
    for (const event of relations) {
      if (event.ts < end) continue;
      end = event.ts + event.dur;
      found.push(event);
    }
  }
  return found;
}

const top = (record, count) =>
  Object.entries(record)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key, value]) => [key, Math.round(value)]);

/**
 * The trace boiled down to what the dashboard shows: self time per event name,
 * the slowest files to check, and the slowest top-level type relations by the
 * checker and type ids the types files resolve.
 */
export function summariseTrace({ events, root, count = HOT_SPOTS }) {
  const byThread = completeEvents({ events });
  const fileMs = {};
  for (const list of byThread.values())
    for (const event of list) {
      if (event.name !== "checkSourceFile" || typeof event.args?.path !== "string") continue;
      const file = relativeTo({ root, path: event.args.path });
      fileMs[file] = (fileMs[file] ?? 0) + event.dur / 1000;
    }
  const relations = outermostRelations({ byThread })
    .toSorted((a, b) => b.dur - a.dur)
    .slice(0, count)
    .map((event) => ({
      ms: Math.round(event.dur / 100) / 10,
      checker: event.args?.checkerId ?? 0,
      sourceId: event.args?.sourceId,
      targetId: event.args?.targetId,
    }));
  return {
    selfMs: Object.fromEntries(top(selfTimeByName({ byThread }), 6)),
    hotFiles: top(fileMs, count),
    hotRelations: relations,
  };
}

/** A type as people read it: its display text or name, and where it is declared. */
export function describeType({ type, root }) {
  if (!type) return "?";
  const name = type.display ?? type.aliasSymbolName ?? type.symbolName ?? type.intrinsicName ?? "?";
  const declaration = type.firstDeclaration;
  if (!declaration?.path) return name;
  return `${name} (${relativeTo({ root, path: declaration.path })}:${declaration.start?.line ?? "?"})`;
}

/** Whether a type line is an instantiation of a generic declared in our own code. */
function ownGenericKey({ type, root }) {
  const name = type.aliasSymbolName ?? type.symbolName;
  const path = type.firstDeclaration?.path ?? "";
  if (!name || path.includes("node_modules")) return null;
  if (!("aliasTypeArguments" in type || "typeArguments" in type || "instantiatedType" in type))
    return null;
  return `${name} ${relativeTo({ root, path })}`;
}

/**
 * One pass over one checker's types file: the types the hot relations name, and
 * the count of instantiations of each of our own generics. Lines are filtered as
 * text before any JSON is parsed, since most of a types file is neither.
 */
export function scanTypes({ lines, wanted, root, generics }) {
  const found = new Map();
  for (const line of lines) {
    const id = Number(/^\[?\{"id":(\d+),/.exec(line)?.[1]);
    const isWanted = wanted.has(id);
    const maybeGeneric =
      !line.includes("node_modules") &&
      (line.includes('"typeArguments"') ||
        line.includes('"aliasTypeArguments"') ||
        line.includes('"instantiatedType"'));
    if (!isWanted && !maybeGeneric) continue;
    const type = parseTraceLine({ line: line.replace(/^\[/, "").replace(/\]$/, "") });
    if (!type) continue;
    if (isWanted) found.set(id, type);
    const key = maybeGeneric ? ownGenericKey({ type, root }) : null;
    if (key) generics[key] = (generics[key] ?? 0) + 1;
  }
  return found;
}

async function* linesOf(file) {
  const reader = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of reader) yield line;
}

async function collect(iterable) {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/** Trace events, read a line at a time and kept only when they can matter. */
async function traceEvents(file) {
  const kept = [];
  for await (const line of linesOf(file)) {
    if (!TIMED_EVENT.test(line)) continue;
    const event = parseTraceLine({ line });
    if (event)
      kept.push({
        ph: event.ph,
        tid: event.tid,
        ts: event.ts,
        dur: event.dur,
        name: event.name,
        args: event.args,
      });
  }
  return kept;
}

async function measure({ root, tsc, file }) {
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
    Object.assign(row, parseDiagnostics({ output }));
    const traceFile = join(scratch, "trace.json");
    if (!existsSync(traceFile)) return row;
    const summary = summariseTrace({ events: await traceEvents(traceFile), root });
    row.selfMs = summary.selfMs;
    row.hotFiles = summary.hotFiles;
    const generics = {};
    const resolved = new Map();
    for (const name of readdirSync(scratch).filter((entry) => /^types(_\d+)?\.json$/.test(entry))) {
      const checker = Number(/_(\d+)/.exec(name)?.[1] ?? 0);
      const wanted = new Set(
        summary.hotRelations
          .filter((relation) => relation.checker === checker)
          .flatMap((relation) => [relation.sourceId, relation.targetId]),
      );
      const found = scanTypes({
        lines: await collect(linesOf(join(scratch, name))),
        wanted,
        root,
        generics,
      });
      for (const [id, type] of found) resolved.set(`${checker}:${id}`, type);
    }
    row.hotRelations = summary.hotRelations.map((relation) => ({
      ms: relation.ms,
      source: describeType({
        type: resolved.get(`${relation.checker}:${relation.sourceId}`),
        root,
      }),
      target: describeType({
        type: resolved.get(`${relation.checker}:${relation.targetId}`),
        root,
      }),
    }));
    row.hotGenerics = top(generics, 5);
    return row;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const args = process.argv.slice(2);
  const outFile =
    args.find((arg) => arg.startsWith("--out="))?.slice(6) ??
    join(root, ".claude/tmp/ts-program-metrics.jsonl");
  const only = args.filter((arg) => !arg.startsWith("--")).map((path) => resolve(path));
  const tsc = join(root, "node_modules/.bin/tsc");
  const targets = only.length > 0 ? only : programs({ root });
  writeFileSync(outFile, "");
  for (const [index, file] of targets.entries()) {
    const row = await measure({ root, tsc, file });
    writeFileSync(outFile, `${JSON.stringify(row)}\n`, { flag: "a" });
    process.stderr.write(
      `${index + 1}/${targets.length} ${row.config} ${row.instantiations ?? "?"}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
