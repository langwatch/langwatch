#!/usr/bin/env node
/**
 * Serializes whole-repo checks across worktrees to avoid CPU/RAM contention.
 * `haven typecheck` coordination follows ADR-064.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Memory budget per concurrent check when deriving the default limit. */
const RAM_BUDGET_BYTES = 6 * 1024 * 1024 * 1024;
/** Cores a single check wants before a second one is worth starting. */
const CPUS_PER_RUN = 4;
/** A lock directory older than this belongs to a process that died holding it. */
const LOCK_STALE_MS = 5_000;
/** How long to keep trying for the lock before proceeding without it. */
const LOCK_GIVE_UP_MS = 10_000;
/** Backstop against a recycled pid keeping a long-dead entry alive forever. */
const ENTRY_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** How often a waiting run repeats itself, so it never looks hung. */
const HEARTBEAT_MS = 30_000;
const DEFAULT_POLL_MS = 500;
const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000;

const PREFIX = "checks:";

const stderr = (line) => process.stderr.write(line);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The CI convention: anything but "no" means yes. CI and CLAUDECODE both read
 * it this way. Mirrors isTruthyEnv in tools/thuishaven/domain/checkslots.go.
 */
function isTruthyEnv(value) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

/**
 * How much trouble the machine is in: green/amber/red, mirroring
 * domain/pressure.go in tools/thuishaven (ADR-090). Darwin-only, chasing the
 * Mac compressor/swap spiral; unreadable or CI reads as green.
 */
function resolvePressure(env) {
  const forced = (env.CHECK_PRESSURE ?? "").trim().toLowerCase();
  if (forced === "green" || forced === "amber" || forced === "red") {
    return forced;
  }
  if (isTruthyEnv(env.CI)) return "green";
  if (process.platform !== "darwin") return "green";

  const probe = (command, args) => {
    try {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 2000 });
      return result.status === 0 ? (result.stdout ?? "") : "";
    } catch {
      return "";
    }
  };

  // "total = 11264.00M  used = 10096.94M  free = ...", used over total.
  let swapFraction = 0;
  const swap = probe("sysctl", ["-n", "vm.swapusage"]);
  const total = /total = ([\d.]+)([MG])/.exec(swap);
  const used = /used = ([\d.]+)([MG])/.exec(swap);
  const inBytes = (m) => Number.parseFloat(m[1]) * (m[2] === "G" ? 2 ** 30 : 2 ** 20);
  if (total && used && inBytes(total) > 0) {
    swapFraction = inBytes(used) / inBytes(total);
  }

  // The page size is in the header (16384 on Apple silicon, 4096 on Intel) and
  // the line is "Pages occupied by compressor", not "stored in": the stored
  // figure is several times larger and reading it would cry red on a healthy
  // machine. Both traps are documented at the Go mirror.
  let compFraction = 0;
  const vmstat = probe("vm_stat", []);
  const pageSize = /page size of (\d+) bytes/.exec(vmstat);
  const occupied = /Pages occupied by compressor:\s+(\d+)/.exec(vmstat);
  if (pageSize && occupied && os.totalmem() > 0) {
    compFraction =
      (Number.parseInt(occupied[1], 10) * Number.parseInt(pageSize[1], 10)) / os.totalmem();
  }

  if (swapFraction > 0.75 || compFraction > 0.2) return "red";
  if (swapFraction > 0.4 || compFraction > 0.1) return "amber";
  return "green";
}

/**
 * One field of `pid` via `ps` (Node knows only its own process). `-ww`
 * because ps otherwise truncates a command line at the terminal width, and
 * the script path this reads for sits at the end of one.
 */
function psField(pid, field) {
  try {
    const args = ["-ww", "-o", `${field}=`, "-p", String(pid)];
    const result = spawnSync("ps", args, {
      encoding: "utf8",
      timeout: 2000,
    });
    if (result.status !== 0) return null;
    const value = (result.stdout ?? "").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/** The parent of `pid`, or null when it cannot be read. */
function parentOfPid(pid) {
  const parent = Number.parseInt(psField(pid, "ppid") ?? "", 10);
  return Number.isInteger(parent) && parent > 0 ? parent : null;
}

/**
 * Whether a command line is one of the two programs that hand a slot down: this
 * script, and the haven binary whose `slot run` does the same job in Go.
 */
function isQueueCommand(command) {
  if (!command) return false;
  if (command.includes("check-queue.mjs")) return true;
  const executable = path.basename(command.trim().split(/\s+/)[0] ?? "");
  return executable === "haven" || executable.startsWith("haven.");
}

/**
 * `candidate` must be BOTH a queue program AND in the live parent chain —
 * ancestry alone would let `CHECK_QUEUE_HELD=$$` grant any shell the
 * gate-off. Not a vault: it only stops the one-token bypass.
 */
function heldByQueueAncestor(candidate) {
  if (!Number.isInteger(candidate) || candidate <= 1) return false;
  const command = psField(candidate, "args");
  if (!isQueueCommand(command)) return false;
  let current = process.pid;
  for (let hop = 0; hop < 64; hop++) {
    const parent = parentOfPid(current);
    if (parent === null || parent <= 1) return false;
    if (parent === candidate) return true;
    current = parent;
  }
  return false;
}

/**
 * Resolves the slot count. Explicit CHECK_SLOTS always wins (even under CI),
 * except an agent's gate-off, ignored per the check below. Otherwise:
 * pressure forces one slot; else the tighter of a memory and a cpu bound.
 */
function resolveSlots(env, pressure = "green") {
  const raw = (env.CHECK_SLOTS ?? "").trim();
  if (raw !== "") {
    const parsed = Number.parseInt(raw, 10);
    const gateOff = /^(off|none|unlimited|false)$/i.test(raw) || parsed === 0;
    if (gateOff) {
      // Honored only when the queue itself asked for it (see
      // heldByQueueAncestor) — an agent must not be able to jump the queue
      // by copying CHECK_QUEUE_HELD or its own $$.
      if (!isTruthyEnv(env.CLAUDECODE)) {
        return { slots: 0, source: "CHECK_SLOTS" };
      }
      const held = Number.parseInt((env.CHECK_QUEUE_HELD ?? "").trim(), 10);
      if (heldByQueueAncestor(held)) {
        return { slots: 0, source: "held" };
      }
      stderr(
        `${PREFIX} CHECK_SLOTS=${raw} is ignored in an agent shell; the machine policy applies. Only a person may turn the queue off.\n`,
      );
    } else if (Number.isNaN(parsed) || parsed < 0) {
      stderr(`${PREFIX} ignoring CHECK_SLOTS=${raw}, expected a non-negative integer\n`);
    } else {
      return { slots: parsed, source: "CHECK_SLOTS" };
    }
  }

  if (isTruthyEnv(env.CI)) {
    return { slots: 0, source: "CI" };
  }

  if (pressure !== "green") {
    return { slots: 1, source: "pressure" };
  }

  const byMemory = Math.floor(os.totalmem() / RAM_BUDGET_BYTES);
  const cpus =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  const byCpu = Math.floor(cpus / CPUS_PER_RUN);
  return { slots: Math.max(1, Math.min(byMemory, byCpu)), source: "machine" };
}

/**
 * The shared state directory. Under the system temp dir so it is per-user on
 * macOS and cleaned by the OS, with the uid in the name so a shared Linux /tmp
 * cannot mix two users' queues.
 */
function resolveQueueDir(env) {
  if (env.CHECK_QUEUE_DIR) return env.CHECK_QUEUE_DIR;
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return path.join(os.tmpdir(), `langwatch-check-slots-${uid}`);
}

/**
 * What a waiting run calls the runs ahead of it. The worktree name is what
 * distinguishes two otherwise identical runs on the same machine.
 */
function resolveLabel(env, commandArgv) {
  const script = env.npm_lifecycle_event;
  const pkg = env.npm_package_name;
  const named = script ? [pkg, script].filter(Boolean).join(" ") : null;
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
  const worktree = path.basename(repoRoot);
  // A direct invocation has no pnpm script to name it, and arrives through the
  // bin shim as `<tool>.real`, which is an implementation detail of the shim.
  const fallback = path.basename(commandArgv[0] ?? "check").replace(/\.real$/, "");
  return `${named ?? fallback} (${worktree})`;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the pid exists but belongs to another user.
    return err.code === "EPERM";
  }
}

function statMtimeMs(target) {
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Runs `body` with the queue lock held. A lock from a process that died
 * mid-decision is broken once stale. Never getting the lock still runs
 * `body` — a miscount beats a check that never starts.
 */
async function withQueueLock(dir, body) {
  // 0o700 because the uid in the directory name makes the path unique, not
  // private: on a shared /tmp anyone could otherwise read the labels, which
  // name worktrees and branches.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, ".lock");
  const giveUpAt = Date.now() + LOCK_GIVE_UP_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const heldFor = Date.now() - (statMtimeMs(lock) ?? Date.now());
      if (heldFor > LOCK_STALE_MS) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > giveUpAt) return body();
      await sleep(5 + Math.floor(Math.random() * 15));
    }
  }
  try {
    return body();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Every live entry in the queue, dropping the ones whose owner is gone. Called
 * only under the lock, so a half-written file cannot be observed here.
 */
function readEntries(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const now = Date.now();
  const entries = [];
  for (const name of names) {
    const file = path.join(dir, name);
    if (!name.endsWith(".json")) {
      // A .tmp left behind by a process that died mid-write. Entries are only
      // ever written under the lock, so anything this old is abandoned.
      const staleTmp = name.endsWith(".tmp") && now - (statMtimeMs(file) ?? now) > LOCK_STALE_MS;
      if (staleTmp) fs.rmSync(file, { force: true });
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      fs.rmSync(file, { force: true });
      continue;
    }
    // The whole point of this directory is that worktrees on different
    // branches share it, so an entry written in a shape this branch does not
    // understand is a normal event, not a corrupt-state emergency. Drop it
    // rather than letting it reach code that assumes the fields exist.
    const usable =
      typeof entry?.token === "string" &&
      Number.isFinite(entry?.arrivedAt) &&
      typeof entry?.state === "string";
    const expired = now - (entry?.arrivedAt ?? 0) > ENTRY_MAX_AGE_MS;
    if (!usable || expired || !pidAlive(entry.pid)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    entries.push({ ...entry, file });
  }
  return entries;
}

/** Arrival order, with the token breaking ties inside the same millisecond. */
function byArrival(a, b) {
  return a.arrivedAt - b.arrivedAt || a.token.localeCompare(b.token);
}

/** Written under the lock, renamed into place so a reader never sees a partial file. */
function writeEntry(entry) {
  const tmp = `${entry.file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entry), "utf8");
  fs.renameSync(tmp, entry.file);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
}

/** The runs ahead of us, named so a waiter can go look at the right worktree. */
function describeActive(entries, now) {
  const shown = entries
    .slice(0, 3)
    .map((e) => `${e.label} for ${formatDuration(now - (e.startedAt ?? now))}`)
    .join(", ");
  const hidden = entries.length - 3;
  return hidden > 0 ? `${shown} and ${hidden} more` : shown;
}

/**
 * Blocks until this run may proceed. Returns how long it waited, whether it
 * announced itself, and whether it gave up on the queue and started anyway.
 */
async function waitForTurn({ dir, ticket, slots, pollMs, maxWaitMs, heartbeatMs }) {
  const queuedAt = Date.now();
  let announced = false;
  let lastBeat = 0;

  for (;;) {
    const outcome = await withQueueLock(dir, () => {
      const entries = readEntries(dir);
      if (!entries.some((e) => e.token === ticket.token)) {
        writeEntry(ticket);
        entries.push(ticket);
      }
      const running = entries.filter((e) => e.state === "running" && e.token !== ticket.token);
      const waiting = entries.filter((e) => e.state === "waiting").sort(byArrival);
      const position = waiting.findIndex((e) => e.token === ticket.token);
      if (position >= 0 && position < slots - running.length) {
        ticket.state = "running";
        ticket.startedAt = Date.now();
        writeEntry(ticket);
        return { granted: true };
      }
      return { granted: false, running, position: position + 1 };
    });

    const waited = Date.now() - queuedAt;
    if (outcome.granted) return { waited, announced, forced: false };

    if (waited >= maxWaitMs) {
      await withQueueLock(dir, () => {
        ticket.state = "running";
        ticket.startedAt = Date.now();
        writeEntry(ticket);
      });
      stderr(
        `${PREFIX} no slot after ${formatDuration(waited)}, starting anyway. ` +
          `Another check may be stuck holding one of the ${slots} slots.\n`,
      );
      return { waited, announced, forced: true };
    }

    const active = outcome.running.length;
    if (!announced) {
      announced = true;
      lastBeat = Date.now();
      const holders = describeActive(outcome.running, Date.now());
      stderr(
        `${PREFIX} ${active} ${active === 1 ? "check is" : "checks are"} ` +
          `already active on this machine (limit ${slots}, set CHECK_SLOTS to change). ` +
          `Queued at position ${outcome.position}, waiting for a free slot` +
          `${holders ? `. Active: ${holders}` : ""}\n`,
      );
    } else if (Date.now() - lastBeat >= heartbeatMs) {
      lastBeat = Date.now();
      const holders = describeActive(outcome.running, Date.now());
      stderr(
        `${PREFIX} still queued at position ${outcome.position} after ` +
          `${formatDuration(waited)}${holders ? `. Active: ${holders}` : ""}\n`,
      );
    }
    await sleep(pollMs);
  }
}

/**
 * With haven installed, hands the run to `haven slot run` (same flock
 * semaphore as `haven typecheck`) instead of the JS queue below. Null means
 * no haven to delegate to. CHECK_QUEUE_IMPL=js forces the JS path for tests.
 */
function delegateToHaven(commandArgv, env) {
  const impl = (env.CHECK_QUEUE_IMPL ?? "").trim().toLowerCase();
  if (impl === "js") {
    return Promise.resolve(null);
  }
  const bin = env.HAVEN_BIN || "haven";
  const argv = ["slot", "run", "--label", resolveLabel(env, commandArgv), "--", ...commandArgv];
  return new Promise((resolve) => {
    const child = spawn(bin, argv, { stdio: "inherit" });
    // Only a spawn that never happened (no haven on PATH) may fall back to
    // the JS queue: once the child ran, falling back would run the command a
    // second time.
    let spawned = false;
    child.on("spawn", () => {
      spawned = true;
    });
    child.on("error", () => resolve(spawned ? 126 : null));
    child.on("exit", (code, signal) => {
      resolve(signal ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 0));
    });
  });
}

/**
 * Soft memory cap for the Go tools this queue wraps: half the machine,
 * clamped to [3,6] GiB — measured, not chosen (ADR-095, ADR-100). Kept in
 * step with domain.CheckGoMemLimit in tools/thuishaven.
 */
function goMemLimit(pressure = "green") {
  if (process.env.GOMEMLIMIT) return process.env.GOMEMLIMIT;
  // Under pressure the floor, outright: the ceiling is garbage the runtime
  // has not collected because it was told there was room, and on a machine
  // that is already compressing and swapping every granted gigabyte is paid
  // by evicting someone else's pages. The floor trades that for the run's own
  // GC time, which is the trade a pressured machine wants.
  if (pressure !== "green") return "3GiB";
  const gib = Math.max(3, Math.min(6, Math.floor(os.totalmem() / 2 ** 31)));
  return `${gib}GiB`;
}

/**
 * Parallelism granted to the Go tools: green sets nothing (every core is
 * right on an idle machine); under pressure, half the cores, never below
 * two — so the run stops fighting someone typing over eleven page faults.
 */
function goMaxProcs(pressure = "green") {
  if (process.env.GOMAXPROCS) return process.env.GOMAXPROCS;
  if (pressure === "green") return null;
  const cpus =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return String(Math.max(2, Math.floor(cpus / 2)));
}

/** Runs the command with stdio inherited, forwarding signals, resolving its exit code. */
function runCommand(commandArgv, pressure = "green") {
  return new Promise((resolve) => {
    const childEnv = {
      ...process.env,
      // We are the slot for everything below us: CHECK_SLOTS=0 plus our pid
      // in CHECK_QUEUE_HELD is what stops a nested bin shim (e.g. tsgo) from
      // queuing behind its own parent.
      CHECK_SLOTS: "0",
      CHECK_QUEUE_HELD: String(process.pid),
      GOMEMLIMIT: goMemLimit(pressure),
    };
    const procs = goMaxProcs(pressure);
    if (procs !== null) childEnv.GOMAXPROCS = procs;
    // Handlers go on BEFORE spawn: a signal before a listener exists kills
    // the wrapper, orphaning the child and freeing its slot — the exact
    // oversubscription this queue exists to prevent. Tracks which signals
    // fired (not just whether) so an unforwarded OS kill is named correctly.
    let child = null;
    const forwarded = new Set();
    const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
      const handler = () => {
        forwarded.add(signal);
        try {
          child?.kill(signal);
        } catch {
          // The child is already gone; its exit event is what resolves us.
        }
      };
      process.on(signal, handler);
      return { signal, handler };
    });
    const detach = () => {
      for (const { signal, handler } of handlers) process.off(signal, handler);
    };
    child = spawn(commandArgv[0], commandArgv.slice(1), {
      stdio: "inherit",
      env: childEnv,
    });
    child.on("error", (err) => {
      detach();
      stderr(`${PREFIX} could not run ${commandArgv[0]}: ${err.message}\n`);
      resolve(127);
    });
    child.on("exit", (code, signal) => {
      // One turn later, so that a signal delivered to the whole process group
      // is in the record before it is read. A Ctrl-C at a terminal reaches the
      // wrapper and the child together, and the child's exit can be handled
      // first, with our own handler for the same signal still pending.
      // Detaching here rather than there would drop that handler outright.
      setImmediate(() => {
        detach();
        // A child that dies by a signal this wrapper never forwarded was killed
        // from outside: an operator, or the OS reclaiming memory. Without this
        // line the run ends in a bare exit 137, which reads as "the queue killed
        // it" and teaches people (and agents) to bypass the queue with
        // CHECK_SLOTS=0, removing the serialization for the whole machine.
        if (signal && !forwarded.has(signal)) {
          stderr(
            `${PREFIX} ${commandArgv[0]} was killed from outside by ${signal}. ` +
              `The queue never kills runs; the likely cause is an operator kill or the OS reclaiming memory. ` +
              `Re-run the same command. Do not set CHECK_SLOTS=0.\n`,
          );
        }
        resolve(signal ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 0));
      });
    });
  });
}

/** `--explain` output: the resolved limit, where it came from, and who holds what. */
async function explain(env) {
  const pressure = resolvePressure(env);
  const { slots, source } = resolveSlots(env, pressure);
  const dir = resolveQueueDir(env);
  stderr(`slots=${slots} source=${source}\npressure=${pressure}\n`);
  stderr(`gomemlimit=${goMemLimit(pressure)}\n`);
  const procs = goMaxProcs(pressure);
  if (procs !== null) stderr(`gomaxprocs=${procs}\n`);
  stderr(`dir=${dir}\n`);
  if (slots <= 0) {
    stderr("queue=off\n");
    return 0;
  }
  let entries;
  try {
    entries = await withQueueLock(dir, () => readEntries(dir));
  } catch (err) {
    stderr(`queue unavailable (${err.message})\n`);
    return 0;
  }
  const running = entries.filter((e) => e.state === "running");
  const waiting = entries.filter((e) => e.state === "waiting").sort(byArrival);
  stderr(`running=${running.length} waiting=${waiting.length}\n`);
  const now = Date.now();
  for (const entry of [...running, ...waiting]) {
    const since = entry.state === "running" ? entry.startedAt : entry.arrivedAt;
    stderr(
      `- ${entry.state} ${entry.label} pid ${entry.pid} for ${formatDuration(now - (since ?? now))}\n`,
    );
  }
  return 0;
}

async function main(argv, env) {
  if (argv[0] === "--explain") return explain(env);

  const commandArgv = argv[0] === "--" ? argv.slice(1) : argv;
  if (commandArgv.length === 0) {
    stderr(
      `${PREFIX} usage: check-queue.mjs <command> [args...]\n` +
        `${PREFIX} runs the command under a machine-wide slot, see CHECK_SLOTS\n`,
    );
    return 2;
  }

  // Measured once: the level shapes the slot count and the child's
  // environment together, and two measurements could disagree.
  const pressure = resolvePressure(env);
  const { slots } = resolveSlots(env, pressure);
  if (slots <= 0) return runCommand(commandArgv, pressure);

  const delegated = await delegateToHaven(commandArgv, env);
  if (delegated !== null) return delegated;

  const dir = resolveQueueDir(env);
  const arrivedAt = Date.now();
  const token = randomBytes(6).toString("hex");
  const ticket = {
    pid: process.pid,
    token,
    arrivedAt,
    state: "waiting",
    startedAt: null,
    label: resolveLabel(env, commandArgv),
    file: path.join(dir, `${arrivedAt}-${process.pid}-${token}.json`),
  };

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      fs.rmSync(ticket.file, { force: true });
    } catch {
      // The next run prunes the entry by pid. Losing a slot for a while beats
      // throwing from an exit handler.
    }
  };
  process.on("exit", release);

  // The queue is a courtesy, never a gate. A /tmp that is read-only, full or
  // owned by someone else must not be the reason a check refuses to run, so
  // only the queueing is inside this boundary: the command itself runs exactly
  // once either way, and a failure inside it is the command's own.
  try {
    const { waited, announced, forced } = await waitForTurn({
      dir,
      ticket,
      slots,
      pollMs: positiveInt(env.CHECK_QUEUE_POLL_MS, DEFAULT_POLL_MS),
      maxWaitMs: positiveInt(env.CHECK_QUEUE_MAX_WAIT_MS, DEFAULT_MAX_WAIT_MS),
      heartbeatMs: positiveInt(env.CHECK_QUEUE_HEARTBEAT_MS, HEARTBEAT_MS),
    });
    if (announced && !forced) {
      stderr(`${PREFIX} slot free after ${formatDuration(waited)} in the queue, starting now.\n`);
    }
  } catch (err) {
    stderr(`${PREFIX} queue unavailable (${err.message}), running without a slot\n`);
  }

  try {
    return await runCommand(commandArgv, pressure);
  } finally {
    release();
  }
}

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

process.exitCode = await main(process.argv.slice(2), process.env);
