#!/usr/bin/env node
/**
 * Takes a dev stack down with whoever started it.
 *
 * An abandoned `pnpm dev` is not a stack that ignored a signal. It is a stack
 * that was never signalled: every process in it shares ONE process group whose
 * leader (the shell that ran `pnpm dev`) is already dead.
 *
 *   PID  PPID  PGID  COMMAND
 *   20277    1 20273 pnpm dev              <- reparented to launchd
 *   ...                                       6 more pnpm/sh levels
 *   24322 23686 20273      concurrently
 *   24390 24329 20273        vite
 *   24452 24425 20273        tsx -> node (api)
 *   28031 24589 20273        go run -> nlpgo
 *
 * Killing the launcher killed one pid. `pnpm` forwards nothing down its script
 * chain, `concurrently` never heard its ancestor was gone, and all 18 kept
 * running: holding ports, querying ClickHouse, draining queues. Three of these
 * on an 18 GB laptop is 35 processes and 1.27 GB, and because the abandoned
 * stack still owns the port, the next `pnpm dev` takes the next slot and the
 * worktree ends up running twice.
 *
 * So this sits at the top of the chain and does three things:
 *
 *   1. Runs the command in a process group of ITS OWN (`detached`). One signal
 *      to that group reaches vite, tsx and `go run` at once, without walking a
 *      tree whose shape changes with every pnpm release. It also means we can
 *      never take down anything we did not start.
 *   2. Watches the group it was launched FROM. When that group's leader dies,
 *      the stack goes down: SIGTERM, then SIGKILL for whatever ignored it.
 *   3. Posts a SENTINEL outside both groups. A hard session teardown SIGKILLs
 *      the launching group as a whole — the shell, the pnpm chain, and this
 *      supervisor in it — and the stack is detached exactly so that teardown
 *      cannot reach it, which also means its watcher dies watching. The
 *      sentinel is a process group of its own that answers to neither kill:
 *      it idles while the supervisor or the launcher is alive, takes the
 *      stack down when both are gone, and exits the moment the stack does.
 *
 * Watching the launching group rather than our own parent is what makes this
 * work at any depth: `pnpm dev` at the repo root delegates through several
 * more `pnpm` levels, all of them inside the doomed group, so a parent-pid
 * check would be watching a process that survives right along with us.
 *
 * In an interactive terminal the shell already puts the job in its own group
 * and the tty sends SIGHUP there, so nothing leaks and there is no separate
 * group leader to watch. This is for the case that does leak: a non-interactive
 * launcher (an agent's shell, a CI-style `sh -c`) that is killed by pid.
 *
 * Dev-only, and never a gate. If any part of the watch cannot be set up, the
 * command still runs unsupervised: a dev server that will not start is worse
 * than one that leaks.
 *
 *   LANGWATCH_DEV_SUPERVISOR=0   run the command unsupervised
 *   LANGWATCH_DEV_GRACE_MS=N     how long the stack gets to exit on its own
 *   LANGWATCH_DEV_WATCH_MS=N     how often the launcher is checked (tests use this)
 *
 *   node dev/scripts/dev-supervisor.mjs <command> [args...]
 */

import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

/** How long the stack gets between SIGTERM and SIGKILL. */
const DEFAULT_GRACE_MS = 5_000;
/** How often we look at whether the launching group still has a leader. */
const WATCH_INTERVAL_MS = 1_000;
/** Set for everything below us, so a nested dev script does not supervise again. */
const NESTED = "LANGWATCH_DEV_SUPERVISED";
/** Re-entry flag for the sentinel process; never typed by hand. */
const SENTINEL_FLAG = "--sentinel";
const PREFIX = "dev-supervisor:";

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
 * The leader of the process group we were launched into, or null when there is
 * nothing to watch: no leader, or the leader is us, which is the shape an
 * interactive shell produces for a job of its own and where the tty already
 * sends SIGHUP to everything.
 *
 * A leader that is one of our own ancestors is deliberately NOT excluded. That
 * is the normal supervised shape: `pnpm dev` delegates through several pnpm
 * levels, all inside the launching group, and that group's leader dying is
 * exactly the event this exists to notice.
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

async function main(argv, env) {
  if (argv[0] === SENTINEL_FLAG) return await runSentinel(argv.slice(1), env);
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

/** Starts the command, or reports why it could not start and returns null. */
function startChild(argv, env, detached) {
  try {
    return spawn(argv[0], argv.slice(1), {
      stdio: "inherit",
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
function stackControls({ target, graceMs }) {
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
    while (Date.now() < deadline && anyAlive()) await sleep(50);

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

/**
 * The sentinel: a group of its own, so no teardown aimed at the launcher or
 * the stack can take it before it has done its job. It idles while either the
 * supervisor or the launcher is alive (whichever of them is up owns the
 * stack's lifetime), takes the stack down when both are gone, and exits as
 * soon as the stack itself is gone — including when the stack was taken down
 * properly and the sentinel was simply never needed.
 *
 * Anything after the three pids in its argv is the guarded command, carried
 * only so `ps` shows what a sentinel is standing for.
 */
async function runSentinel(args, env) {
  const stackPid = Number.parseInt(args[0] ?? "", 10);
  const supervisorPid = Number.parseInt(args[1] ?? "", 10);
  const leaderPid = Number.parseInt(args[2] ?? "", 10);
  if (!Number.isInteger(stackPid) || stackPid <= 1) return 64;

  const everyMs = positiveInt(env.LANGWATCH_DEV_WATCH_MS, WATCH_INTERVAL_MS);
  const stack = stackControls({
    target: -stackPid,
    graceMs: positiveInt(env.LANGWATCH_DEV_GRACE_MS, DEFAULT_GRACE_MS),
  });
  const watched = (pid) => Number.isInteger(pid) && pid > 1 && alive(pid);

  for (;;) {
    if (!stack.anyAlive()) return 0;
    if (!watched(supervisorPid) && !watched(leaderPid)) {
      await stack.takeDown();
      return 0;
    }
    await sleep(everyMs);
  }
}

/**
 * Posts the sentinel for a detached stack. Failing to post one is not a gate:
 * the supervisor's own watch still covers every case except its own SIGKILL.
 */
function startSentinel({ stackPid, leader, argv, env }) {
  try {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        SENTINEL_FLAG,
        String(stackPid),
        String(process.pid),
        String(leader),
        ...argv,
      ],
      { detached: true, stdio: "ignore", env },
    );
    child.unref();
  } catch (err) {
    stderr(`${PREFIX} could not post the sentinel (${err.message})\n`);
  }
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
 * Runs the command and returns its exit code. With `detached`, the child leads
 * a process group of its own and every takedown targets that group.
 */
function passThrough(argv, env, { detached, leader = null }) {
  const child = startChild(argv, env, detached);
  if (child === null) return Promise.resolve(127);
  if (detached) startSentinel({ stackPid: child.pid, leader, argv, env });

  return new Promise((resolve) => {
    const stack = stackControls({
      target: detached ? -child.pid : child.pid,
      graceMs: positiveInt(env.LANGWATCH_DEV_GRACE_MS, DEFAULT_GRACE_MS),
    });
    let watch = null;
    let takingDown = false;
    let childResult = null;

    // clearInterval ignores null, so the watch never needs guarding.
    const finish = () => {
      clearInterval(watch);
      resolve(exitCodeFor(childResult));
    };

    const stop = async (why) => {
      if (takingDown) return;
      takingDown = true;
      clearInterval(watch);
      if (why !== null) stderr(`${PREFIX} ${why}, stopping the dev stack.\n`);
      if (!(await stack.takeDown())) {
        stderr(
          `${PREFIX} some of the dev stack outlived SIGKILL, giving up.\n`,
        );
      }
      finish();
    };

    watch = watchLauncher({ leader, env, onGone: stop });

    // Our own signals go to the stack, not just to the top of it. Without
    // this, Ctrl-C on a detached child reaches us and nothing else.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => void stop(null));
    }

    child.on("error", (err) => {
      stderr(`${PREFIX} could not start ${argv[0]} (${err.message})\n`);
      clearInterval(watch);
      resolve(127);
    });

    child.on("close", (code, signal) => {
      childResult = { code, signal };
      // Mid-takedown this is just one lane going quiet; `stop` decides when the
      // stack is actually down.
      if (!takingDown) finish();
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

process.exitCode = await main(process.argv.slice(2), process.env);
