#!/usr/bin/env node
/**
 * Tears down detached dev stacks when their launcher dies; `--watch` debounces
 * restarts (one at a time, held while an agent works, see ADR-168) and collapses
 * crash output while preserving full traces in a log.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

/** How long the stack gets between SIGTERM and SIGKILL. */
const DEFAULT_GRACE_MS = 5_000;
/** How often we look at whether the launching group still has a leader. */
const WATCH_INTERVAL_MS = 1_000;
/** Set for everything below us, so a nested dev script does not supervise again. */
const NESTED = "LANGWATCH_DEV_SUPERVISED";
/** Re-entry flag for the sentinel process; never typed by hand. */
const SENTINEL_FLAG = "--sentinel";
/** Opts a command into debounced watch-and-restart instead of a one-shot run. */
const WATCH_FLAG = "--watch";
/**
 * Quiet window before a restart. An agent writes one file per tool call, seconds
 * apart, so 750 ms saw every edit as its own burst (ADR-168): 2 s coalesces a
 * turn's edits. `LANGWATCH_DEV_WATCH_DEBOUNCE_MS` overrides it.
 */
const DEFAULT_WATCH_DEBOUNCE_MS = 2_000;
/** A restart is never put off longer than this after the first unhandled change. */
const DEFAULT_WATCH_MAX_WAIT_MS = 30_000;
/** A boot that never says it is ready settles anyway after this (cold start p90 is 24 s). */
const DEFAULT_BOOT_SETTLE_MS = 30_000;
/** The agent-turn hold (`.haven-hmr-gate`) defers a restart at most this long. */
const MAX_HOLD_MS = 60_000;
/** How often a held restart looks at whether the hold was released. */
const HOLD_POLL_MS = 500;
/** Default watch roots, relative to cwd: the package's own source, plus every
 * workspace package (architecture-enforcer already forbids api/worker code from
 * reaching a web/ui package, so this needs no per-app allowlist). */
const DEFAULT_WATCH_DIRS = ["src", "../../packages", "../../modules", "../../enterprise"];
/** Never worth a restart: tests, build output, generated code, watcher noise. */
const WATCH_IGNORE_PATTERNS = [
  /(^|\/)__tests__(\/|$)/,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /(^|\/)(dist|generated)(\/|$)/,
  /\.tsbuildinfo$/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  // An editor or agent writing `name.ts.tmp.<pid>.<hash>` then renaming it over
  // the target: the rename is the change worth a restart, the temp file is not.
  /\.tmp\.\d+\.[0-9a-f]+$/,
  // A test's scratch directory (`.tmp-rest-handler-tQBUui/fixture.ts`): a
  // suite running beside the stack must not restart it once per fixture.
  /(^|\/)\.tmp-[^/]+(\/|$)/,
  // A build tool bundling its own config beside it: tsup writes
  // `tsup.config.bundled_<hash>.mjs` and vite `vite.config.ts.timestamp-<n>.mjs`,
  // then deletes it. `ensure:built` runs on every lane's predev and every
  // scoped test, so on a shared checkout one session's build bounced another's
  // api. specs/setup/dev-process-topology.feature.
  /(^|\/)[^/]*\.config\.bundled_[^/]*\.mjs$/,
  /(^|\/)[^/]*\.config\.[cm]?[jt]s\.timestamp-[^/]*\.mjs$/,
  // An agent probing the import graph writes `__probe__.ts` into a watched
  // source directory and deletes it seconds later. Boot is slower than the gap
  // between probes, so a stack under a probing session never finished starting.
  // No tracked file is named this way. specs/setup/dev-process-topology.feature.
  /(^|\/)__[a-z0-9_]*probe[a-z0-9_]*\.[cm]?[jt]sx?$/,
  // A module's browser half, which no api/worker code may import (the
  // enforcer's frontend/server separation). Reloading for it is pure churn,
  // and on a shared checkout it lets one session's screen work bounce
  // another's backend. specs/setup/dev-process-topology.feature.
  /(^|\/)modules\/[^/]+\/browser(-kit)?(\/|$)/,
  // Prose and specs: no backend process ever loads them.
  /\.(md|mdx|feature)$/,
  /(^|\/)tsconfig[^/]*\.json$/,
];
/** The pipe the sentinel reports the stack's pid, then its exit code, on. */
const HANDSHAKE_FD = 3;
const PREFIX = "dev-supervisor:";
const SELF = fileURLToPath(import.meta.url);
/** dev/scripts/dev-supervisor.mjs is two levels below the repo root. */
const REPO_ROOT = path.resolve(path.dirname(SELF), "../..");
/** Escape hatch: forward a crash's raw output instead of collapsing it. */
const RAW_CRASH_ENV = "LANGWATCH_DEV_RAW_CRASH";
/** Override for where the full trace/dump of a collapsed crash is appended. */
const CRASH_LOG_ENV = "LANGWATCH_DEV_CRASH_LOG";

const stderr = (msg) => process.stderr.write(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Whether `pid` is still around. EPERM means it is, owned by someone else. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * The launching group's leader, or null when there is nothing to watch (the
 * interactive-shell case, whose tty already sends SIGHUP). An ancestor
 * leader is deliberately not excluded — that is the normal `pnpm dev` shape.
 */
function launchingGroupLeader() {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], {
    encoding: "utf8",
  });
  const pgid = Number.parseInt((result.stdout ?? "").trim(), 10);
  if (!Number.isInteger(pgid) || pgid <= 1) return null;
  if (pgid === process.pid) return null;
  if (!alive(pgid)) return null;
  return pgid;
}

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function disabled(env) {
  const raw = (env[NESTED] ?? "").trim();
  if (raw !== "" && raw !== "0" && raw !== "false") return "already supervised";
  const off = (env.LANGWATCH_DEV_SUPERVISOR ?? "").trim().toLowerCase();
  if (off === "0" || off === "false" || off === "off") return "turned off";
  return null;
}

async function main(argv, env, { buildBundle } = {}) {
  if (argv[0] === SENTINEL_FLAG) return await runSentinel(argv.slice(1), env);
  if (argv[0] === WATCH_FLAG) {
    if (resolveWatchConfig(env).enabled)
      return await runWatchSupervisor(argv.slice(1), env, buildBundle);
    argv = argv.slice(argv[1] === "--" ? 2 : 1);
  }
  if (argv.length === 0) {
    stderr(`${PREFIX} usage: dev-supervisor.mjs <command> [args...]\n`);
    return 64;
  }

  // Nested and opted-out runs still go through here, so stdio and the exit
  // code behave the same, but the command gets no group of its own and nothing
  // watches it: exactly what running it directly would have done.
  if (disabled(env) !== null) {
    return await passThrough(argv, env, { detached: false });
  }

  const leader = launchingGroupLeader();
  return await passThrough(argv, env, { detached: leader !== null, leader });
}

// --- --watch: debounced restart-on-change ---------------------------------

/** Whether a changed path is churn nobody should restart for. */
export function shouldIgnoreWatchPath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (isConfigJson(normalized)) return true;
  return WATCH_IGNORE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** A `.json` outside a `src/` tree that is not a package.json: tool config, never imported. */
function isConfigJson(normalized) {
  if (!normalized.endsWith(".json")) return false;
  if (normalized.endsWith("package.json")) return false;
  return !/(^|\/)src\//.test(normalized);
}

/** The watch roots and quiet window, from the environment (or its defaults). */
export function resolveWatchConfig(env) {
  const rawDirs = (env.LANGWATCH_DEV_WATCH_DIRS ?? "").trim();
  const dirs =
    rawDirs === ""
      ? DEFAULT_WATCH_DIRS
      : rawDirs
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
  // LANGWATCH_DEV_WATCH=0 runs `--watch` one-shot: a stack diff tools measure
  // must not restart on another session's edits (havenrun.Env sets it).
  const watch = (env.LANGWATCH_DEV_WATCH ?? "").trim().toLowerCase();
  return {
    enabled: !["0", "false", "off"].includes(watch),
    dirs,
    debounceMs: positiveInt(env.LANGWATCH_DEV_WATCH_DEBOUNCE_MS, DEFAULT_WATCH_DEBOUNCE_MS),
    maxWaitMs: positiveInt(env.LANGWATCH_DEV_WATCH_MAX_WAIT_MS, DEFAULT_WATCH_MAX_WAIT_MS),
    bootSettleMs: positiveInt(env.LANGWATCH_DEV_BOOT_SETTLE_MS, DEFAULT_BOOT_SETTLE_MS),
    readyPattern: (env.LANGWATCH_DEV_READY_PATTERN ?? "").trim(),
    holdMarker:
      (env.LANGWATCH_DEV_HOLD_MARKER ?? "").trim() ||
      path.join(REPO_ROOT, "apps", "ui", ".haven-hmr-gate"),
  };
}

/** The dev-bundle entry/output, or null when the caller wants a plain restart with no rebuild. */
export function resolveBundleConfig(env) {
  const entry = (env.LANGWATCH_DEV_BUNDLE_ENTRY ?? "").trim();
  const outfile = (env.LANGWATCH_DEV_BUNDLE_OUT ?? "").trim();
  if (entry === "" || outfile === "") return null;
  return { entry, outfile };
}

// --- crash rendering: collapse a crash down to one line -------------------

/** Whether the raw-output escape hatch is on. */
export function rawCrashEnabled(env) {
  const raw = (env[RAW_CRASH_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** Where the full trace/dump of a collapsed crash is appended, one lane at a
 * time: an explicit override, or a file named after the watched package's own
 * directory under the OS temp dir. */
export function crashLogPath(env) {
  const explicit = (env[CRASH_LOG_ENV] ?? "").trim();
  if (explicit !== "") return explicit;
  return path.join(os.tmpdir(), "langwatch-dev-crash", `${path.basename(process.cwd())}.log`);
}

/** Best-effort: a crash log write must never be what keeps a crash from being
 * reported, so a failure here (a read-only temp dir, a missing parent) is
 * swallowed rather than raised. */
function appendCrashLog(logPath, text) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `--- ${new Date().toISOString()} ---\n${text}\n`);
  } catch {
    // Nowhere to put it. The collapsed line the developer still sees is what
    // matters; losing the extra detail is the lesser failure.
  }
}

/** A path made relative to the repo root when it is inside it, unchanged
 * otherwise — so a frame under node_modules or outside the checkout still
 * prints as something a person can find. */
function relativeToRepo(absPath) {
  if (!absPath || !path.isAbsolute(absPath)) return absPath;
  const rel = path.relative(REPO_ROOT, absPath);
  return rel.startsWith("..") ? absPath : rel;
}

/** One V8 stack frame line, as either `at fn (path:line:col)` or
 * `at path:line:col`. Null for anything else (blank lines, the "Caused by:"
 * banner some libraries add, …). */
function parseFrame(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("at ")) return null;
  const withParens = trimmed.match(/\(([^()]+):(\d+):(\d+)\)\s*$/);
  if (withParens) return { path: withParens[1], line: withParens[2] };
  const bare = trimmed.match(/^at\s+(?:async\s+)?([^\s()]+):(\d+):(\d+)$/);
  return bare ? { path: bare[1], line: bare[2] } : null;
}

/** The first frame in a stack that is worth pointing someone at: inside this
 * repo, not a dependency, not Node's own internals. Null when the trace has
 * none — a rejection surfaced from library code alone, say. */
export function firstAppFrame(stack) {
  if (!stack) return null;
  for (const rawLine of stack.split("\n")) {
    const frame = parseFrame(rawLine);
    if (!frame) continue;
    if (frame.path.startsWith("node:")) continue;
    if (frame.path.includes("/node_modules/")) continue;
    return { file: relativeToRepo(frame.path), line: frame.line };
  }
  return null;
}

/**
 * Collapses a `processFailureLine` record to one line: the stack becomes a
 * `file:line` suffix on the message. Null when there's nothing to collapse.
 */
export function collapseStackRecord(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  if (!trimmed.endsWith("}")) return null;
  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) return null;
  const stack = typeof record.stack === "string" ? record.stack : "";
  if (stack === "") return null;

  const frame = firstAppFrame(stack);
  const baseMsg = recordMessage(record);
  const msg = frame ? `${baseMsg} — at ${frame.file}:${frame.line}` : baseMsg;

  const collapsed = { ...record, msg };
  delete collapsed.stack;
  delete collapsed.message;
  return { collapsed: JSON.stringify(collapsed), rawText: `${baseMsg}\n${stack}` };
}

function recordMessage(record) {
  if (typeof record.msg === "string") return record.msg;
  if (typeof record.message === "string") return record.message;
  return "";
}

/** Node's ESM loader refusing a named import the target module never
 * exports. The file:line Node prints ahead of the SyntaxError is the
 * importing location; the first such reference in the dump is it. */
export function classifyMissingExport(text) {
  const match = text.match(
    /SyntaxError: The requested module '([^']+)' does not provide an export named '([^']+)'/,
  );
  if (!match) return null;
  const [, specifier, exportName] = match;
  const location = text.match(/^(\/\S+):(\d+)$/m);
  return {
    kind: "missing-export",
    specifier,
    exportName,
    file: location ? relativeToRepo(location[1]) : null,
    line: location ? location[2] : null,
  };
}

/** Node's ESM loader refusing to resolve an import at all — a workspace
 * package never built, a typo, a dependency never installed. */
export function classifyMissingPackage(text) {
  const match = text.match(
    /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package '([^']+)' imported from ([^\n]+)/,
  );
  if (!match) return null;
  const [, specifier, importer] = match;
  return { kind: "missing-package", specifier, importer: relativeToRepo(importer.trim()) };
}

/**
 * Fallback shape: an exception thrown before anything could catch it (a
 * top-level module, an unhandled rejection pre-handler). Finds the first
 * Error-banner line and takes the stack frames after it.
 */
export function classifyBootException(text) {
  const lines = text.split("\n");
  // The prefix before "Error" is optional: Node's own ERR_MODULE_NOT_FOUND and
  // ERR_UNSUPPORTED_DIR_IMPORT throw the bare built-in `Error` class, not a
  // subclass, so "Error [ERR_MODULE_NOT_FOUND]: ..." must match too.
  const bannerIndex = lines.findIndex((line) =>
    /^\s*(?:[A-Za-z_$][\w$.]*)?Error(?:\s*\[[A-Z_]+\])?:\s/.test(line),
  );
  if (bannerIndex === -1) return null;
  const banner = lines[bannerIndex]
    .trim()
    .match(/^((?:[A-Za-z_$][\w$.]*)?Error(?:\s*\[[A-Z_]+\])?):\s*(.*)$/);
  if (!banner) return null;
  const [, errorType, message] = banner;
  return {
    kind: "boot-exception",
    errorType,
    message,
    frame: firstAppFrame(lines.slice(bannerIndex).join("\n")),
  };
}

/** Tries every raw-crash shape in order, most specific first. Null when none
 * of them recognise the dump — the caller passes it through unchanged rather
 * than guessing at a shape nobody named. */
export function classifyRawCrash(text) {
  return classifyMissingExport(text) ?? classifyMissingPackage(text) ?? classifyBootException(text);
}

/** The one line a classified crash renders as: the kind of failure and the
 * facts a person acts on, never the raw dump. */
export function crashMessage(classified) {
  switch (classified.kind) {
    case "missing-export": {
      const where = classified.file
        ? `${classified.file}${classified.line ? `:${classified.line}` : ""}`
        : "an unknown location";
      return `missing export: module '${classified.specifier}' does not export '${classified.exportName}' (imported at ${where})`;
    }
    case "missing-package":
      return `missing package: cannot find '${classified.specifier}' (imported from ${classified.importer})`;
    case "boot-exception": {
      const where = classified.frame
        ? `${classified.frame.file}:${classified.frame.line}`
        : "an unknown location";
      return `${classified.errorType}: ${classified.message} — at ${where}`;
    }
    default:
      return "unrecognised crash";
  }
}

/** A classified raw crash, rendered as the same one-JSON-line-at-fatal shape
 * every other structured record uses. */
export function crashRecordLine(classified) {
  return JSON.stringify({
    time: new Date().toISOString(),
    level: "fatal",
    msg: crashMessage(classified),
  });
}

/**
 * Reads the child's stdout: the escape hatch passes bytes straight through;
 * otherwise a `stack`-carrying record collapses to one line (full text kept
 * in the crash log) and everything else passes through untouched.
 */
function wireStdout(stream, { raw, crashLog, onLine }) {
  if (raw) {
    stream.pipe(process.stdout);
    if (onLine) stream.on("data", (chunk) => onLine(String(chunk)));
    return;
  }
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  reader.on("line", (line) => {
    onLine?.(line);
    const collapsed = collapseStackRecord(line);
    if (collapsed) {
      process.stdout.write(`${collapsed.collapsed}\n`);
      appendCrashLog(crashLog, collapsed.rawText);
      return;
    }
    process.stdout.write(`${line}\n`);
  });
}

/**
 * Reads the child's stderr, holding lines until quiet for `quietMs` (a crash
 * dump arrives as one burst and the telling line isn't always last), then
 * classifies the whole burst: a recognised crash renders as one line.
 */
function writeBurst({ pending, crashLog }) {
  const text = pending.join("\n");
  const classified = classifyRawCrash(text);
  if (classified) {
    process.stderr.write(`${crashRecordLine(classified)}\n`);
    appendCrashLog(crashLog, text);
    return;
  }
  for (const line of pending) process.stderr.write(`${line}\n`);
}

function wireStderr(stream, { raw, crashLog, quietMs = 150 }) {
  if (raw) {
    stream.pipe(process.stderr);
    return;
  }
  const pending = [];
  let buffer = "";
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (buffer !== "") {
      pending.push(buffer);
      buffer = "";
    }
    if (pending.length === 0) return;
    writeBurst({ pending, crashLog });
    pending.length = 0;
  };
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      pending.push(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, quietMs);
  });
  stream.on("end", flush);
  stream.on("close", flush);
}

/**
 * Coalesces changes into one `onFire` after `debounceMs` of quiet, naming every
 * file. `maxWaitMs` bounds the wait from the first change so a trickle cannot
 * starve it; `holdMs()` (an agent mid-turn) defers it, at most `holdCapMs`.
 */
export function createDebouncer({
  debounceMs,
  maxWaitMs = Number.POSITIVE_INFINITY,
  holdMs = () => 0,
  holdCapMs = MAX_HOLD_MS,
  holdPollMs = HOLD_POLL_MS,
  onFire,
}) {
  let timer = null;
  let firstAt = 0;
  let heldSince = 0;
  const pending = new Set();
  const arm = (ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, ms));
    timer.unref?.();
  };
  function fire() {
    timer = null;
    const hold = holdMs();
    if (hold > 0) {
      heldSince ||= Date.now();
      const left = holdCapMs - (Date.now() - heldSince);
      if (left > 0) return arm(Math.min(hold, holdPollMs, left));
    }
    heldSince = 0;
    const files = [...pending];
    pending.clear();
    onFire(files);
  }
  const note = (file) => {
    if (pending.size === 0) firstAt = Date.now();
    pending.add(file);
    arm(Math.min(debounceMs, firstAt + maxWaitMs - Date.now()));
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    heldSince = 0;
    pending.clear();
  };
  return { note, cancel };
}

/**
 * One reload at a time. A request during a run is queued, merged with any
 * others, and answered by exactly one follow-up run once the current one ends.
 */
export function createReloadQueue({ run }) {
  let running = false;
  let queued = null;
  const request = async (files) => {
    if (running) {
      queued ??= new Set();
      for (const file of files) queued.add(file);
      return;
    }
    running = true;
    try {
      for (let batch = files; batch; batch = takeQueued()) await run(batch);
    } finally {
      running = false;
    }
  };
  const takeQueued = () => {
    const next = queued === null ? null : [...queued];
    queued = null;
    return next;
  };
  return { request, isBusy: () => running };
}

/** Milliseconds the agent-turn marker still holds a restart: 0 when absent, stale or unreadable. */
export function holdRemainingMs({ marker, now = Date.now() }) {
  try {
    const expiry = Number(fs.readFileSync(marker, "utf8").trim());
    return Number.isFinite(expiry) ? Math.min(Math.max(expiry - now, 0), MAX_HOLD_MS) : 0;
  } catch {
    return 0;
  }
}

/** Where workspace packages live, for resolving a dependency to its directory. */
const WORKSPACE_ROOTS = ["apps", "tools", "packages", "modules", "enterprise"];
/** Directories never worth descending into while looking for package.json files. */
const PACKAGE_SCAN_SKIP = new Set(["src", "node_modules", "dist", "generated", "__tests__"]);

/** Records `dir`'s package.json in `byName`; a half-written one is skipped. */
function recordPackage({ dir, byName }) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (typeof pkg.name === "string") byName.set(pkg.name, { dir, pkg });
  } catch {
    // Not a package, or one mid-write: nothing to record.
  }
}

const isScannable = (entry) =>
  entry.isDirectory() && !entry.name.startsWith(".") && !PACKAGE_SCAN_SKIP.has(entry.name);

/** Every workspace package under `roots`, by name: `{ dir, pkg }`. */
function scanWorkspacePackages({ roots, depth = 4 }) {
  const byName = new Map();
  const visit = (dir, left) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "package.json"))
      recordPackage({ dir, byName });
    if (left === 0) return;
    for (const entry of entries.filter(isScannable)) visit(path.join(dir, entry.name), left - 1);
  };
  for (const root of roots) visit(root, depth);
  return byName;
}

/**
 * The workspace packages the command can load: its own and its dependencies,
 * transitively (pnpm resolves declared ones only). A file in no known package
 * is never filtered: guessing wrong there hides a real change.
 */
export function createBackendFilter({ cwd, roots }) {
  const byName = scanWorkspacePackages({ roots });
  let own = null;
  try {
    own = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch {
    return { isOutsideBackend: () => false };
  }
  byName.set(own.name, { dir: cwd, pkg: own });
  const loadable = new Set();
  const queue = [own.name];
  while (queue.length > 0) {
    const name = queue.pop();
    if (loadable.has(name)) continue;
    loadable.add(name);
    const { pkg } = byName.get(name) ?? { pkg: {} };
    const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
    if (name === own.name) Object.assign(deps, pkg.devDependencies);
    for (const dep of Object.keys(deps)) if (byName.has(dep)) queue.push(dep);
  }
  const owners = [...byName.entries()].toSorted((x, y) => y[1].dir.length - x[1].dir.length);
  const isOutsideBackend = (absPath) => {
    const owner = owners.find(
      ([, { dir }]) => absPath === dir || absPath.startsWith(dir + path.sep),
    );
    return owner !== undefined && !loadable.has(owner[0]);
  };
  return { isOutsideBackend, loadable };
}

/**
 * Watches `dirs` and feeds non-ignored changes to `debouncer`. An
 * unwatchable directory is skipped with a warning, never a gate — the
 * command still runs, just without live reload for that path.
 */
function watchDirs({ dirs, debouncer, filter }) {
  const watchers = [];
  for (const dir of dirs) {
    const abs = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(abs)) continue;
    try {
      const watcher = fs.watch(abs, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = path.join(dir, filename);
        if (shouldIgnoreWatchPath(rel)) return;
        if (filter.isOutsideBackend(path.join(abs, filename))) return;
        debouncer.note(rel);
      });
      watchers.push(watcher);
    } catch (err) {
      stderr(
        `${PREFIX} not watching ${dir} (${err.message}); changes there need a manual restart\n`,
      );
    }
  }
  return watchers;
}

/**
 * Runs `<command>` in the SAME process group as this supervisor (not
 * detached) so an external group-wide SIGTERM reaches it directly, and
 * restarts it, debounced, by pid — never the shared group — on tree changes.
 */
async function runWatchSupervisor(rawArgv, env, buildBundle) {
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  if (argv.length === 0) {
    stderr(`${PREFIX} usage: dev-supervisor.mjs --watch -- <command> [args...]\n`);
    return 64;
  }
  return new WatchSupervisor(argv, env, buildBundle).run();
}

/** One watched command: its current child, its reloads and its exit. */
class WatchSupervisor {
  handle = null;
  settledCode = 0;
  finished = false;
  watchers = [];

  constructor(argv, env, buildBundle) {
    this.argv = argv;
    this.env = env;
    this.buildBundle = buildBundle;
    const config = resolveWatchConfig(env);
    this.config = config;
    this.graceMs = positiveInt(env.LANGWATCH_DEV_GRACE_MS, DEFAULT_GRACE_MS);
    this.bundle = resolveBundleConfig(env);
    this.ready = config.readyPattern === "" ? null : new RegExp(config.readyPattern);
    this.crashOptions = {
      raw: rawCrashEnabled(env),
      crashLog: crashLogPath(env),
      onLine: (text) => this.noteOutput(text),
    };
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    this.queue = createReloadQueue({ run: (files) => this.reload(files) });
    this.debouncer = createDebouncer({
      debounceMs: config.debounceMs,
      maxWaitMs: config.maxWaitMs,
      holdMs: () => holdRemainingMs({ marker: config.holdMarker }),
      onFire: (files) => void this.queue.request(files),
    });
  }

  async run() {
    const watched = this.config.dirs.map((d) => path.resolve(process.cwd(), d));
    const roots = [
      ...new Set([...watched, ...WORKSPACE_ROOTS.map((d) => path.join(REPO_ROOT, d))]),
    ];
    const filter = createBackendFilter({ cwd: process.cwd(), roots });
    this.watchers = watchDirs({ dirs: this.config.dirs, debouncer: this.debouncer, filter });
    const firstBuild = await this.rebuild();
    if (!firstBuild.ok) {
      for (const w of this.watchers) w.close();
      return 1;
    }
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => this.onSignal());
    }
    void this.queue.request([]); // the first boot is a reload too: a change during it queues
    return await this.exited;
  }

  /**
   * The bundle builder is handed in by whoever starts the supervisor, so this
   * file loads with node builtins only (dev-supervisor.test.ts runs a copy).
   */
  async rebuild() {
    if (this.bundle === null) return { ok: true };
    if (!this.buildBundle) {
      return {
        ok: false,
        errors: ["LANGWATCH_DEV_BUNDLE_ENTRY is set, but no bundle builder was handed in"],
      };
    }
    const result = await this.buildBundle({ appDir: process.cwd(), ...this.bundle });
    if (!result.ok) {
      stderr(`${PREFIX} bundle failed, keeping the previous run:\n`);
      for (const line of result.errors) stderr(`${PREFIX}   ${line}\n`);
    }
    return result;
  }

  /** Starts a child and its boot: `settled` resolves when it is ready, dead or out of time. */
  spawnOne() {
    const child = startChild(this.argv, this.env, false, { captureIO: true });
    if (child === null) return false;
    let settle = () => {};
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(settle, this.config.bootSettleMs);
    timer.unref?.();
    const handle = { child, stopping: false, settle, settled };
    this.handle = handle;
    if (child.stdout) wireStdout(child.stdout, this.crashOptions);
    if (child.stderr) wireStderr(child.stderr, this.crashOptions);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      settle();
      if (handle.stopping || this.handle !== handle) return; // ours; the reload owns what follows
      this.onExit({ code, signal });
    });
    return true;
  }

  /** A line of the current child's output: the ready pattern ends its boot. */
  noteOutput(text) {
    if (this.ready !== null && this.handle !== null && this.ready.test(text)) this.handle.settle();
  }

  /**
   * A non-zero exit is a crash: say so once and wait for the next change, since
   * exiting would end the lane. A signal, a clean exit, or a crash with nothing
   * watched ends us instead.
   */
  onExit({ code, signal }) {
    if (signal !== null || code === 0 || code === null || this.watchers.length === 0) {
      this.settledCode = exitCodeFor({ code, signal });
      this.finish();
      return;
    }
    this.handle = null;
    stderr(`${PREFIX} exited with code ${code}; waiting for the next change to start it again\n`);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.debouncer.cancel();
    for (const w of this.watchers) w.close();
    this.resolveExit(this.settledCode);
  }

  /**
   * With a bundle configured the rebuild gates the restart, so a broken edit
   * keeps the old run. A reload ends when its boot settles: the queue never
   * starts a second on top of it.
   */
  async reload(files) {
    if (this.finished) return;
    if (files.length > 0 && !(await this.restartOld(files))) return;
    if (this.finished) return;
    if (!this.spawnOne()) {
      this.settledCode = 127;
      return this.finish();
    }
    await this.handle.settled;
  }

  /** Rebuilds, then takes the running child down; false when a failed rebuild kept it. */
  async restartOld(files) {
    const built = await this.rebuild();
    if (!built.ok || this.finished) return false;
    const noun = files.length === 1 ? "file" : "files";
    const more = files.length > 3 ? ", …" : "";
    stderr(
      `${PREFIX} restarting (${files.length} ${noun} changed): ${files.slice(0, 3).join(", ")}${more}\n`,
    );
    const old = this.handle;
    if (old !== null) {
      old.stopping = true;
      const stack = stackControls({ target: old.child.pid, graceMs: this.graceMs });
      if (!(await stack.takeDown())) {
        stderr(`${PREFIX} some of the previous run outlived SIGKILL, restarting anyway\n`);
      }
    }
    return true;
  }

  onSignal() {
    const old = this.handle;
    if (this.finished || old === null) return this.finish();
    old.stopping = true;
    void stackControls({ target: old.child.pid, graceMs: this.graceMs })
      .takeDown()
      .then(() => this.finish());
  }
}

/** A detached child's whole process group, or nothing to signal when it never got a pid. */
function processGroupOf(pid) {
  return pid === undefined ? undefined : -pid;
}

/**
 * Starts the command, or reports why and returns null. `captureIO` is what
 * lets the crash renderer see stdout/stderr; off, `stdio: "inherit"` passes
 * through untouched, same as before this existed.
 */
function startChild(argv, env, detached, { captureIO = false } = {}) {
  try {
    return spawn(argv[0], argv.slice(1), {
      stdio: captureIO ? ["inherit", "pipe", "pipe"] : "inherit",
      detached,
      env: { ...env, [NESTED]: "1" },
    });
  } catch (err) {
    stderr(`${PREFIX} could not start ${argv[0]} (${err.message})\n`);
    return null;
  }
}

/**
 * How to reach the running stack. `target` is a negative pid for a detached
 * child, which addresses its whole process group; for a child we could not
 * detach it is just the child, the honest limit of an unsupervised run.
 */
export function stackControls({ target, graceMs }) {
  const send = (signal) => {
    try {
      process.kill(target, signal);
    } catch {
      // Already gone, or never started. Either way there is nothing to do.
    }
  };

  /** Signal 0 succeeds while ANY member of the group is still alive. */
  const anyAlive = () => {
    try {
      process.kill(target, 0);
      return true;
    } catch (err) {
      return err.code === "EPERM";
    }
  };

  /** Asks the stack to stop, insists if it does not, and reports whether it went. */
  const takeDown = async () => {
    send("SIGTERM");

    // `start.sh` runs `concurrently --restart-tries -1`, which answers a dead
    // lane by starting a new one. So our own child exiting is not the stack
    // being down: what has to go quiet is the whole process group. Waiting on
    // that rather than on the child is the difference between a reaped stack
    // and one that respawns every lane behind us and keeps the ports.
    const deadline = Date.now() + graceMs;
    while (true) {
      if (Date.now() >= deadline) break;
      if (!anyAlive()) break;
      await sleep(50);
    }

    // Anything still up ignored SIGTERM or was restarted under it. SIGKILL
    // cannot be ignored, but a lane started moments before it lands can still
    // miss it, so confirm rather than assume.
    for (let attempt = 0; attempt < 5 && anyAlive(); attempt += 1) {
      send("SIGKILL");
      await sleep(100);
    }
    return !anyAlive();
  };

  return { takeDown, anyAlive };
}

/** The sentinel's half of the handshake. A closed pipe is never a failure. */
function tell(value) {
  try {
    fs.writeSync(HANDSHAKE_FD, `${value}\n`);
  } catch {
    // Nobody listening: run by hand, or the supervisor is already gone.
  }
}

function hangUp() {
  try {
    fs.closeSync(HANDSHAKE_FD);
  } catch {
    // Already closed, or never a pipe.
  }
}

/** The exit code a child settles with: 127 when it could not start. */
function settlementOf({ child, command }) {
  return new Promise((resolve) => {
    child.on("error", (err) => {
      stderr(`${PREFIX} could not start ${command} (${err.message})\n`);
      resolve(127);
    });
    child.on("close", (status, signal) => resolve(exitCodeFor({ code: status, signal })));
  });
}

/** Tells the launcher the stack's exit code and hangs up, at most once. */
function createExitReport() {
  let reported = false;
  return {
    get reported() {
      return reported;
    },
    send(code) {
      if (reported) return;
      reported = true;
      tell(code ?? exitCodeFor(null));
      hangUp();
    },
  };
}

const isWatched = (pid) => Number.isInteger(pid) && pid > 1 && alive(pid);

/**
 * The sentinel: the stack's parent, in a session of its own, so no teardown
 * of the launching group can reach it. Idles while the supervisor or
 * launcher is alive, takes the stack down when both are gone.
 */
async function runSentinel(args, env) {
  const supervisorPid = Number.parseInt(args[0] ?? "", 10);
  const leaderPid = Number.parseInt(args[1] ?? "", 10);
  const argv = args.slice(2);
  if (argv.length === 0) return 64;

  const child = startChild(argv, env, true);
  // Out before anything else can happen to the stack. From here the supervisor
  // can address it, and this process is already its parent either way.
  tell(child?.pid ?? 0);
  if (child === null) {
    hangUp();
    return 127;
  }

  let code = null;
  const settled = settlementOf({ child, command: argv[0] });
  void settled.then((value) => {
    code = value;
  });

  const stack = stackControls({
    target: processGroupOf(child.pid),
    graceMs: positiveInt(env.LANGWATCH_DEV_GRACE_MS, DEFAULT_GRACE_MS),
  });
  const everyMs = positiveInt(env.LANGWATCH_DEV_WATCH_MS, WATCH_INTERVAL_MS);
  const neitherWatched = () => !isWatched(supervisorPid) && !isWatched(leaderPid);
  const exit = createExitReport();

  for (;;) {
    if (code !== null) exit.send(code);
    // Only once the stack has been seen to settle: a group that has not been
    // observed yet reads as "quiet" while the command is still being exec'd.
    if (exit.reported && !stack.anyAlive()) break;
    if (neitherWatched()) {
      await stack.takeDown();
      break;
    }
    if (code === null) await Promise.race([settled, sleep(everyMs)]);
    else await sleep(everyMs);
  }

  exit.send(code);
  return code ?? exitCodeFor(null);
}

/**
 * Starts the sentinel and waits for the stack's pid. Null means the caller
 * runs the command itself — an unguarded run beats one that refuses to
 * start.
 */
async function startSentinel({ leader, argv, env }) {
  let proc = null;
  try {
    proc = spawn(
      process.execPath,
      [SELF, SENTINEL_FLAG, String(process.pid), String(leader ?? 0), ...argv],
      {
        detached: true,
        // The stack's stdio is ours, passed down a level; fd 3 is the pipe it
        // answers on. Node closes it on exec, so the stack never holds it open.
        stdio: ["inherit", "inherit", "inherit", "pipe"],
        env,
      },
    );
  } catch (err) {
    stderr(`${PREFIX} could not post the sentinel (${err.message})\n`);
    return null;
  }
  // It outlives us on purpose, so it must never be what holds our exit open.
  // The handshake pipe is what keeps us alive while the stack runs.
  proc.unref();

  // spawn reports some failures only after it has handed back a child, and an
  // "error" nobody listens for takes this process down with it — which is the
  // one thing supervision must never do to the command it is supervising.
  let failure = null;
  const failed = new Promise((resolve) => {
    proc.on("error", (err) => {
      failure = err;
      resolve();
    });
  });

  let stackPid = null;
  let onExit = null;
  let exitBeforeAsked = null;
  const deliver = (code) => {
    if (onExit === null) exitBeforeAsked = code;
    else onExit(code);
  };
  const reported = new Promise((resolve) => {
    readHandshake(proc.stdio[HANDSHAKE_FD], {
      onPid: (value) => {
        stackPid = value;
        resolve();
      },
      onExit: (value) => deliver(value ?? exitCodeFor(null)),
    });
  });

  await Promise.race([reported, failed]);
  if (stackPid === null) {
    const why = failure === null ? "it named no stack" : failure.message;
    stderr(`${PREFIX} the sentinel did not come up (${why}), running on.\n`);
    return null;
  }

  return {
    target: async () => -stackPid,
    onFailed: () => {},
    onExit: (cb) => {
      onExit = cb;
      if (exitBeforeAsked !== null) cb(exitBeforeAsked);
    },
  };
}

/**
 * Reads the handshake: the stack's pid, then its exit code — two lines,
 * not a wait on the sentinel itself (it outlives the stack). A closed
 * stream with nothing left answers both as null.
 */
function deliverHandshakeLine({ seen, line, onPid, onExit }) {
  const value = Number.parseInt(line, 10);
  const parsed = Number.isInteger(value) ? value : null;
  if (seen === 1) {
    onPid(parsed !== null && parsed > 1 ? parsed : null);
    return;
  }
  onExit(parsed);
}

function readHandshake(stream, { onPid, onExit }) {
  if (!stream) {
    onPid(null);
    onExit(null);
    return;
  }
  let buffer = "";
  let seen = 0;
  const take = (line) => {
    if (seen >= 2) return;
    seen += 1;
    deliverHandshakeLine({ seen, line, onPid, onExit });
  };

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
      take(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  });
  const end = () => {
    while (seen < 2) take("");
  };
  stream.on("end", end);
  stream.on("error", end);
}

/** Runs the command in this process, the way an unguarded run always did. */
function startDirect(argv, env, detached) {
  const child = startChild(argv, env, detached);
  if (child === null) return null;
  return {
    target: async () => (detached ? processGroupOf(child.pid) : child.pid),
    onFailed: (cb) =>
      child.on("error", (err) => {
        stderr(`${PREFIX} could not start ${argv[0]} (${err.message})\n`);
        cb(127);
      }),
    onExit: (cb) => child.on("close", (code, signal) => cb(exitCodeFor({ code, signal }))),
  };
}

/** Polls for the launcher's death, or null when there is nothing to watch. */
function watchLauncher({ leader, env, onGone }) {
  if (leader === null) return null;
  const everyMs = positiveInt(env.LANGWATCH_DEV_WATCH_MS, WATCH_INTERVAL_MS);
  const timer = setInterval(() => {
    if (!alive(leader)) {
      onGone(`the process that started this dev stack (${leader}) is gone`);
    }
  }, everyMs);
  timer.unref();
  return timer;
}

/**
 * A detached run goes through a sentinel, which actually spawns the stack;
 * anything else runs the command here. A sentinel that fails to start falls
 * back to a direct run rather than failing the command.
 */
async function startRun(argv, env, { detached, leader }) {
  if (detached) {
    const sentinel = await startSentinel({ leader, argv, env });
    if (sentinel !== null) return sentinel;
  }
  return startDirect(argv, env, detached);
}

async function takeDownRun({ run, env }) {
  const target = await run.target();
  if (target === null) return;
  const stack = stackControls({
    target,
    graceMs: positiveInt(env.LANGWATCH_DEV_GRACE_MS, DEFAULT_GRACE_MS),
  });
  if (!(await stack.takeDown())) {
    stderr(`${PREFIX} some of the dev stack outlived SIGKILL, giving up.\n`);
  }
}

/**
 * Runs the command and returns its exit code. With `detached`, the stack leads
 * a process group of its own and every takedown targets that group.
 */
async function passThrough(argv, env, { detached, leader = null }) {
  const run = await startRun(argv, env, { detached, leader });
  if (run === null) return 127;

  return await new Promise((resolve) => {
    let watch = null;
    let takingDown = false;
    let settled = false;
    let stackCode = null;

    // clearInterval ignores null, so the watch never needs guarding.
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      resolve(code);
    };

    const stop = async (why) => {
      if (takingDown) return;
      takingDown = true;
      clearInterval(watch);
      if (why !== null) stderr(`${PREFIX} ${why}, stopping the dev stack.\n`);
      await takeDownRun({ run, env });
      finish(stackCode ?? exitCodeFor(null));
    };

    watch = watchLauncher({ leader, env, onGone: stop });

    // Our own signals go to the stack, not just to the top of it. Without
    // this, Ctrl-C on a detached child reaches us and nothing else.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => void stop(null));
    }

    run.onFailed((code) => finish(code));

    run.onExit((code) => {
      stackCode = code;
      // Mid-takedown this is just one lane going quiet; `stop` decides when the
      // stack is actually down.
      if (!takingDown) finish(code);
    });
  });
}

/**
 * The exit code to report. A stack we took down never reports its own, so it
 * reads as terminated, which is what happened to it.
 */
function exitCodeFor(childResult) {
  const { code, signal } = childResult ?? { code: null, signal: "SIGTERM" };
  if (signal) {
    // Every signal this platform has, so a stack that dies of SIGQUIT or
    // SIGSEGV reports 131 or 139 rather than a flat 128.
    return 128 + (os.constants.signals[signal] ?? 0);
  }
  return code ?? 0;
}

// realpathSync on both sides: a straight string compare breaks across a
// symlink (macOS's /tmp -> /private/tmp) since argv[1] keeps the invoked
// path while import.meta.url reports the resolved one — exactly the case
// dev-supervisor.test.ts hits by copying this file into a scratch tmp dir.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
