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
 *   CHECK_PRESSURE=<level>   Forces the memory-pressure level (green, amber or
 *                            red) instead of measuring it. Unset measures; a
 *                            misspelling measures too. Under amber or red the
 *                            derived limit narrows to one run, GOMEMLIMIT
 *                            drops to its floor and GOMAXPROCS is halved, so
 *                            the check pays for the shortage instead of
 *                            everything else on the machine.
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
 * The CI convention: the variable is set to something that is not one of the
 * values meaning "not CI". The slot limit and the pressure policy both ask
 * this, so they ask it in one place and cannot drift apart. Mirrors
 * isTruthyCI in tools/thuishaven/domain/checkslots.go.
 */
function isTruthyCI(ci) {
  const value = (ci ?? "").trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false";
}

/**
 * How much trouble the machine is in: "green", "amber" or "red". A mirror of
 * domain/pressure.go in tools/thuishaven, which is the source of truth for the
 * thresholds (ADR-090): swap above 40% is amber and above 75% red, compressor
 * occupancy above 10% of RAM is amber and above 20% red, and either signal
 * alone can raise the level. CHECK_PRESSURE forces a level the same way for an
 * operator and for the tests; a misspelling measures, like a CHECK_SLOTS typo.
 *
 * A machine this cannot read is green: a governor that cannot see must not
 * throttle. Only darwin is measured, because the thrash this exists to stop is
 * the compressor-and-swap spiral of a memory-oversubscribed Mac.
 *
 * CI is green whatever the machine says. The queue already stands down there,
 * and the same reasoning retires the pressure policy with it: a runner runs one
 * job and nobody is typing on it, so halving its cores buys back an interactive
 * machine that does not exist and only makes the job slower. This is what makes
 * "CI is unaffected" true rather than a side effect of the runner's kernel.
 */
function resolvePressure(env) {
  const forced = (env.CHECK_PRESSURE ?? "").trim().toLowerCase();
  if (forced === "green" || forced === "amber" || forced === "red") {
    return forced;
  }
  if (isTruthyCI(env.CI)) return "green";
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
  const inBytes = (m) =>
    Number.parseFloat(m[1]) * (m[2] === "G" ? 2 ** 30 : 2 ** 20);
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
      (Number.parseInt(occupied[1], 10) * Number.parseInt(pageSize[1], 10)) /
      os.totalmem();
  }

  if (swapFraction > 0.75 || compFraction > 0.2) return "red";
  if (swapFraction > 0.4 || compFraction > 0.1) return "amber";
  return "green";
}

/**
 * Resolves how many checks may proceed at once.
 *
 * An explicit CHECK_SLOTS always wins, including under CI, which is what lets
 * the tests exercise the queue on a CI runner. Unset, CI gets no queue at all
 * (one job runs one check, so a gate could only add risk) and a developer
 * machine gets a limit bounded by both memory and cores: tsgo is memory-hungry
 * AND parallel, so the tighter of the two bounds is the honest one. Never below
 * 1, or the queue would deadlock every run.
 *
 * A machine already under memory pressure gets one slot, whatever the formula
 * says. The formula assumes an otherwise idle machine, and pressure is the
 * machine reporting that assumption false: its RAM is spoken for, so a second
 * concurrent check is paid for in everyone's swap. Only the derived default
 * narrows; an explicit CHECK_SLOTS is the operator's call either way.
 */
function resolveSlots(env, pressure = "green") {
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

  if (isTruthyCI(env.CI)) {
    return { slots: 0, source: "CI" };
  }

  if (pressure !== "green") {
    return { slots: 1, source: "pressure" };
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

/**
 * On a machine with haven installed, the queue's decisions are Go code inside
 * haven: the run is handed to `haven slot run`, which takes a slot from the
 * same flock semaphore `haven typecheck` holds — one counter for everything
 * that saturates the cores — then runs the command with CHECK_SLOTS=0 and
 * GOMEMLIMIT set, exactly as runCommand below would. Resolves to the child's
 * exit code, or null when there is no haven to delegate to (the JS queue
 * below then takes over — the fallback for machines without haven).
 * CHECK_QUEUE_IMPL=js forces the JS queue, which is how its tests pin it.
 */
function delegateToHaven(commandArgv, env) {
  if ((env.CHECK_QUEUE_IMPL ?? "").trim().toLowerCase() === "js") {
    return Promise.resolve(null);
  }
  const bin = env.HAVEN_BIN || "haven";
  const argv = [
    "slot",
    "run",
    "--label",
    resolveLabel(env, commandArgv),
    "--",
    ...commandArgv,
  ];
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
 * Soft memory cap for the Go-runtime tools this queue wraps (the TypeScript
 * compiler is a Go binary): GOMEMLIMIT makes the runtime collect harder to stay
 * under the limit instead of ballooning (ADR-095). Half the machine, clamped to
 * [3,6] GiB; an operator's explicit GOMEMLIMIT always wins. The haven daemon's
 * process watch is the hard backstop above this.
 *
 * Both ends of the clamp are measured, not chosen — see ADR-100. GOMEMLIMIT is
 * a ceiling the runtime expands toward, so the old cap of 10 turned an 18 GiB
 * laptop into a 9 GiB typecheck against a 2.29 GB working set; and a limit
 * below the live heap is worse than none, because the runtime collects
 * continuously and misses it anyway.
 *
 * Kept in step with domain.CheckGoMemLimit in tools/thuishaven, which is what
 * actually runs on a machine with haven installed. This is the fallback.
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
 * The parallelism the queue grants the Go-runtime tools it wraps. Green sets
 * nothing (every core is the right spend for one run on an idle machine);
 * under pressure half the cores, never below two, so the run stops being
 * eleven threads all taking page faults while somebody tries to type. An
 * operator's explicit GOMAXPROCS always wins.
 */
function goMaxProcs(pressure = "green") {
  if (process.env.GOMAXPROCS) return process.env.GOMAXPROCS;
  if (pressure === "green") return null;
  const cpus =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length;
  return String(Math.max(2, Math.floor(cpus / 2)));
}

/** Runs the command with stdio inherited, forwarding signals, resolving its exit code. */
function runCommand(commandArgv, pressure = "green") {
  return new Promise((resolve) => {
    const childEnv = {
      ...process.env,
      // We are the slot for everything below us. Without this, a run holding
      // the only slot queues behind itself the moment it reaches a bin shim
      // (`pnpm typecheck` spawns .bin/tsgo, which is one) or a nested package
      // script, and waits out the whole maximum wait before starting.
      CHECK_SLOTS: "0",
      GOMEMLIMIT: goMemLimit(pressure),
    };
    const procs = goMaxProcs(pressure);
    if (procs !== null) childEnv.GOMAXPROCS = procs;
    const child = spawn(commandArgv[0], commandArgv.slice(1), {
      stdio: "inherit",
      env: childEnv,
    });
    // Handling these keeps the wrapper alive through a Ctrl-C so it releases its
    // slot after the child is done, instead of dying first and leaving an entry
    // for the next run to prune.
    // Which signals were forwarded, not merely whether any was. A run that is
    // interrupted and then killed by the OS dies of a signal nobody forwarded,
    // and that is the death worth naming; a flag would have suppressed it
    // because an earlier SIGINT set it.
    const forwarded = new Set();
    const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
      const handler = () => {
        forwarded.add(signal);
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
