#!/usr/bin/env node
/**
 * Machine-wide queue for the whole-repo checks: typecheck and lint.
 *
 * Both saturate the machine on purpose. A tsgo run peaks around 3 to 4 GiB and
 * uses every core; a biome run over 6,800 files spends 38 CPU-seconds in 4
 * seconds of wall clock. That is the right trade for one run. The three or four
 * that a laptop driving several worktrees and agents produces are what make the
 * machine unusable, and neither command knew another was already running.
 *
 * This wrapper takes a slot from a counter shared by every worktree, terminal
 * and agent on the machine, runs the real command, and releases the slot. One
 * counter covers typecheck and lint together, because they compete for the same
 * cores. On the happy path it prints nothing and is transparent: stdio is
 * inherited, the exit code is passed through, and signals are forwarded. It
 * speaks only when a run has to wait, which is exactly when the caller needs to
 * know that the extra minutes were queueing rather than a hung tool.
 *
 *   node dev/scripts/check-queue.mjs <command> [args...]
 *   node dev/scripts/check-queue.mjs --explain
 *
 * Environment:
 *   CHECK_SLOTS=N            How many checks may proceed at once. 0 (or "off")
 *                            disables the queue entirely. Unset derives a limit
 *                            from the machine, and is off under CI, where one
 *                            job runs one check.
 *   CHECK_QUEUE_DIR=<path>   Where the shared state lives.
 *   CHECK_QUEUE_POLL_MS=N    How often a waiter re-checks (default 500).
 *   CHECK_QUEUE_HEARTBEAT_MS How often a waiting run repeats itself so it never
 *                            looks hung (default 30s).
 *   CHECK_QUEUE_MAX_WAIT_MS  Give up waiting and run anyway (default 30m), so a
 *                            wedged queue can never block a check.
 *
 * The state is a directory of one small JSON file per run, holding its pid,
 * arrival sequence, label and state. Occupancy is counted from the files whose
 * pid is still alive, so a killed run frees its slot with no bookkeeping, and
 * waiters are served in arrival order. A short-lived lock directory serialises
 * the read-decide-write step between processes.
 *
 * `haven typecheck` (ADR-064) holds one of its own RAM slots and passes
 * CHECK_SLOTS=0 to the run it spawns, so a run is never counted twice.
 */

import { spawn } from "node:child_process";
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
 * Resolves how many checks may proceed at once.
 *
 * An explicit CHECK_SLOTS always wins, including under CI, which is what lets
 * the tests exercise the queue on a CI runner. Unset, CI gets no queue at all
 * (one job runs one check, so a gate could only add risk) and a developer
 * machine gets a limit bounded by both memory and cores: tsgo is memory-hungry
 * AND parallel, so the tighter of the two bounds is the honest one. Never below
 * 1, or the queue would deadlock every run.
 */
function resolveSlots(env) {
  const raw = (env.CHECK_SLOTS ?? "").trim();
  if (raw !== "") {
    if (/^(off|none|unlimited|false)$/i.test(raw)) {
      return { slots: 0, source: "CHECK_SLOTS" };
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      stderr(
        `${PREFIX} ignoring CHECK_SLOTS=${raw}, expected a non-negative integer\n`,
      );
    } else {
      return { slots: parsed, source: "CHECK_SLOTS" };
    }
  }

  const ci = (env.CI ?? "").trim().toLowerCase();
  if (ci !== "" && ci !== "0" && ci !== "false") {
    return { slots: 0, source: "CI" };
  }

  const byMemory = Math.floor(os.totalmem() / RAM_BUDGET_BYTES);
  const cpus =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length;
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
 * Runs `body` with the queue lock held. Whoever creates the lock directory
 * wins, and a lock left behind by a process that died mid-decision is broken
 * once it goes stale. Failing to ever get the lock runs the body anyway: a
 * miscounted slot is a far better outcome than a check that never starts.
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
      const staleTmp =
        name.endsWith(".tmp") &&
        now - (statMtimeMs(file) ?? now) > LOCK_STALE_MS;
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
async function waitForTurn({
  dir,
  ticket,
  slots,
  pollMs,
  maxWaitMs,
  heartbeatMs,
}) {
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
      const running = entries.filter(
        (e) => e.state === "running" && e.token !== ticket.token,
      );
      const waiting = entries
        .filter((e) => e.state === "waiting")
        .sort(byArrival);
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

/** Runs the command with stdio inherited, forwarding signals, resolving its exit code. */
function runCommand(commandArgv) {
  return new Promise((resolve) => {
    const child = spawn(commandArgv[0], commandArgv.slice(1), {
      stdio: "inherit",
      // We are the slot for everything below us. Without this, a run holding
      // the only slot queues behind itself the moment it reaches a bin shim
      // (`pnpm typecheck` spawns .bin/tsgo, which is one) or a nested package
      // script, and waits out the whole maximum wait before starting.
      env: { ...process.env, CHECK_SLOTS: "0" },
    });
    // Handling these keeps the wrapper alive through a Ctrl-C so it releases its
    // slot after the child is done, instead of dying first and leaving an entry
    // for the next run to prune.
    const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
      const handler = () => {
        try {
          child.kill(signal);
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
    child.on("error", (err) => {
      detach();
      stderr(`${PREFIX} could not run ${commandArgv[0]}: ${err.message}\n`);
      resolve(127);
    });
    child.on("exit", (code, signal) => {
      detach();
      resolve(signal ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 0));
    });
  });
}

/** `--explain` output: the resolved limit, where it came from, and who holds what. */
async function explain(env) {
  const { slots, source } = resolveSlots(env);
  const dir = resolveQueueDir(env);
  stderr(`slots=${slots} source=${source}\ndir=${dir}\n`);
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

  const { slots } = resolveSlots(env);
  if (slots <= 0) return runCommand(commandArgv);

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
      stderr(
        `${PREFIX} slot free after ${formatDuration(waited)} in the queue, starting now.\n`,
      );
    }
  } catch (err) {
    stderr(
      `${PREFIX} queue unavailable (${err.message}), running without a slot\n`,
    );
  }

  try {
    return await runCommand(commandArgv);
  } finally {
    release();
  }
}

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

process.exitCode = await main(process.argv.slice(2), process.env);
