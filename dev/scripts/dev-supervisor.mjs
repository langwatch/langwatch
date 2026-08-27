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
 *   3. Puts a SENTINEL between itself and the stack. A hard session teardown
 *      SIGKILLs the launching group as a whole — the shell, the pnpm chain,
 *      and this supervisor in it — and the stack is detached exactly so that
 *      teardown cannot reach it, which also means its watcher dies watching.
 *      The sentinel is a session of its own that answers to neither kill: it
 *      idles while the supervisor or the launcher is alive, takes the stack
 *      down when both are gone, and goes when the last lane does.
 *
 * The sentinel is started BEFORE the stack and is what spawns it, so there is
 * no instant in which a detached stack exists with nothing outside the doomed
 * group watching it. Starting the stack first and the sentinel second would
 * leave exactly that window, and a SIGKILL landing in it reproduces the
 * original leak in full. The two talk over a pipe on fd 3: the sentinel
 * reports the stack's pid as soon as it has one, so the supervisor can still
 * address the stack itself, and its exit code when it ends.
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
import fs from "node:fs";
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
/** The pipe the sentinel reports the stack's pid, then its exit code, on. */
const HANDSHAKE_FD = 3;
const PREFIX = "dev-supervisor:";
const SELF = fileURLToPath(import.meta.url);

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

/**
 * The sentinel: the stack's parent, in a session of its own, so no teardown
 * aimed at the launching group can reach it and the stack is never without a
 * guard outside that group. It idles while either the supervisor or the
 * launcher is alive (whichever of them is up owns the stack's lifetime),
 * takes the stack down when both are gone, and exits once the last lane is
 * gone — including when the stack was taken down properly and the sentinel
 * was simply never needed.
 *
 * Anything after the two pids in its argv is the guarded command, which it
 * runs and which `ps` therefore shows as what a sentinel stands for.
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
  const settled = new Promise((resolve) => {
    child.on("error", (err) => {
      stderr(`${PREFIX} could not start ${argv[0]} (${err.message})\n`);
      resolve(127);
    });
    child.on("close", (status, signal) => resolve(exitCodeFor({ code: status, signal })));
  });
  void settled.then((value) => {
    code = value;
  });

  const stack = stackControls({
    target: -child.pid,
    graceMs: positiveInt(env.LANGWATCH_DEV_GRACE_MS, DEFAULT_GRACE_MS),
  });
  const everyMs = positiveInt(env.LANGWATCH_DEV_WATCH_MS, WATCH_INTERVAL_MS);
  const watched = (pid) => Number.isInteger(pid) && pid > 1 && alive(pid);
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    tell(code ?? exitCodeFor(null));
    hangUp();
  };

  for (;;) {
    if (code !== null) report();
    // Only once the stack has been seen to settle: a group that has not been
    // observed yet reads as "quiet" while the command is still being exec'd.
    if (reported && !stack.anyAlive()) break;
    if (!watched(supervisorPid) && !watched(leaderPid)) {
      await stack.takeDown();
      break;
    }
    if (code === null) await Promise.race([settled, sleep(everyMs)]);
    else await sleep(everyMs);
  }

  report();
  return code ?? exitCodeFor(null);
}

/**
 * Starts the sentinel, which starts the stack, and waits for it to say which
 * pid the stack got. Returns null when it never does, so the caller can run
 * the command itself: an unguarded run is the cost of a sentinel that will not
 * start, and a dev server that refuses to come up is not.
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
 * The supervisor's half of the handshake: the stack's pid, then its exit code.
 * Two lines rather than waiting on the sentinel itself, which stays up as long
 * as any lane does and would otherwise make a stack that exits on its own look
 * like one this had to wait for. An end with nothing on it answers both.
 */
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
    const value = Number.parseInt(line, 10);
    const parsed = Number.isInteger(value) ? value : null;
    seen += 1;
    if (seen === 1) onPid(parsed !== null && parsed > 1 ? parsed : null);
    else onExit(parsed);
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
    target: async () => (detached ? -child.pid : child.pid),
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
 * Starts the run this supervisor reports on. A detached run goes through a
 * sentinel, which is what actually spawns the stack; anything else runs the
 * command here. A sentinel that cannot be started falls back to the direct
 * run rather than failing the command.
 */
async function startRun(argv, env, { detached, leader }) {
  if (detached) {
    const sentinel = await startSentinel({ leader, argv, env });
    if (sentinel !== null) return sentinel;
  }
  return startDirect(argv, env, detached);
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
      const target = await run.target();
      if (target !== null) {
        const stack = stackControls({
          target,
          graceMs: positiveInt(env.LANGWATCH_DEV_GRACE_MS, DEFAULT_GRACE_MS),
        });
        if (!(await stack.takeDown())) {
          stderr(`${PREFIX} some of the dev stack outlived SIGKILL, giving up.\n`);
        }
      }
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

process.exitCode = await main(process.argv.slice(2), process.env);
