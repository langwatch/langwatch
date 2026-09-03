import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  type WriteStream,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { exitCause } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import type { ServiceName, ServicePaths } from "./paths.ts";

export type SpawnSpec = {
  name: ServiceName;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
};

export type SupervisedHandle = {
  name: string;
  pid: number;
  child: ChildProcess;
  stop(): Promise<void>;
};

export type RestartPolicy = {
  /** Restarts granted to a service that crashes after having been healthy. */
  maxRestarts: number;
  /** Delay before each restart attempt; the last entry repeats if the list is shorter than maxRestarts. */
  backoffMs: readonly number[];
  /** Uptime after which the restart counter resets to zero. */
  steadyUptimeMs: number;
};

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxRestarts: 3,
  backoffMs: [1_000, 5_000, 15_000],
  steadyUptimeMs: 5 * 60_000,
};

type ExitInfo = {
  code: number | null;
  signal: NodeJS.Signals | null;
  logStream: WriteStream;
};

/** Mutable bookkeeping for one supervised service, threaded through the helpers below. */
type SupervisionState = {
  spec: SpawnSpec;
  bus: EventBus;
  restartPolicy: RestartPolicy;
  logPath: string;
  pidPath: string;
  currentChild: ChildProcess;
  stopped: boolean;
  hasBeenHealthy: boolean;
  restartCount: number;
  backoffTimer: NodeJS.Timeout | null;
  steadyTimer: NodeJS.Timeout | null;
  untap: () => void;
};

/**
 * Spawn a child process under supervision: tee stdout/stderr to its log file
 * AND emit "log" events on the bus so the CLI can render to TTY. Writes a
 * pidfile so a stale process can be detected on the next CLI run.
 *
 * Crash policy: a crash before the service's first "healthy" event is a boot
 * failure and fails fast with a "crashed" event, exactly once. A crash after
 * the service has been healthy is retried in place with bounded backoff
 * (announced via "restarting" events); staying up for `steadyUptimeMs`
 * refills the budget. When the budget is exhausted the crash falls through
 * to the "crashed" event. Supervision learns about "healthy" by observing
 * the bus; the health probes live in each service's start helper.
 *
 * The returned handle's `stop()` sends SIGTERM, waits up to 10s for clean
 * exit, then SIGKILLs. It also cancels any pending restart. Idempotent.
 * `pid` and `child` always reflect the current (most recently spawned)
 * process.
 */
export function supervise({
  spec,
  paths,
  bus,
  restartPolicy = DEFAULT_RESTART_POLICY,
}: {
  spec: SpawnSpec;
  paths: ServicePaths;
  bus: EventBus;
  restartPolicy?: RestartPolicy;
}): SupervisedHandle {
  const logPath = paths.log(spec.name);
  const pidPath = paths.pid(spec.name);
  mkdirSync(dirname(logPath), { recursive: true });
  mkdirSync(dirname(pidPath), { recursive: true });

  const state = makeSupervisionState({
    spec,
    bus,
    restartPolicy,
    logPath,
    pidPath,
  });
  spawnAttempt(state);

  return {
    name: spec.name,
    get pid() {
      return state.currentChild.pid ?? -1;
    },
    get child() {
      return state.currentChild;
    },
    stop: () => stopSupervised(state),
  };
}

function makeSupervisionState({
  spec,
  bus,
  restartPolicy,
  logPath,
  pidPath,
}: {
  spec: SpawnSpec;
  bus: EventBus;
  restartPolicy: RestartPolicy;
  logPath: string;
  pidPath: string;
}): SupervisionState {
  const state: SupervisionState = {
    spec,
    bus,
    restartPolicy,
    logPath,
    pidPath,
    currentChild: null as unknown as ChildProcess,
    stopped: false,
    hasBeenHealthy: false,
    restartCount: 0,
    backoffTimer: null,
    steadyTimer: null,
    untap: () => {},
  };
  // Supervision learns "this service was healthy" by observing the bus
  // rather than being told directly; the health probes live in each
  // service's start helper (langwatch.ts, postgres.ts, ...), not here.
  state.untap = bus.tap((ev) => {
    if (ev.type === "healthy" && ev.service === spec.name) state.hasBeenHealthy = true;
  });
  return state;
}

/** Launch (or relaunch, on restart) the child and wire its termination to `handleExit`. */
function spawnAttempt(state: SupervisionState): void {
  const logStream = createWriteStream(state.logPath, { flags: "a" });
  const child = nodeSpawn(state.spec.command, state.spec.args, {
    env: state.spec.env,
    cwd: state.spec.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  state.currentChild = child;

  if (typeof child.pid === "number") {
    writeFileSync(state.pidPath, String(child.pid));
  }

  // Track stdout + stderr "end" events so we can drain any buffered lines
  // BEFORE closing the log file. If we end() the logStream synchronously
  // on child 'exit', the readline transformer may still be flushing the
  // last chunk and we lose tail data, caught by spawn.integration.test
  // intermittently failing on the 'row-2' assertion. Wait for both pipes
  // to finish before closing.
  const pipesDrained: Promise<void>[] = [
    pipeLines(child, "stdout", state.spec.name, logStream, state.bus),
    pipeLines(child, "stderr", state.spec.name, logStream, state.bus),
  ];

  restartSteadyTimer(state);
  wireChildTermination(state, child, logStream, pipesDrained);
}

/**
 * A child ends its life one of two ways: it exits (cleanly or a crash), or
 * it never really started at all ("error": ENOENT/EACCES/EPERM spawning the
 * command). Both funnel into the same handleExit dispatch, gated by a
 * settle-once guard so only whichever fires first is processed. Node does
 * not reliably follow a failed spawn with "exit", so relying on "exit"
 * alone leaves that failure completely unhandled, and an unhandled "error"
 * event throws and takes down the whole CLI process, restart logic or not.
 */
function wireChildTermination(
  state: SupervisionState,
  child: ChildProcess,
  logStream: WriteStream,
  pipesDrained: Promise<void>[],
): void {
  let settled = false;
  const settleOnce = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (settled) return;
    settled = true;
    safeUnlink(state.pidPath);
    clearSteadyTimer(state);
    void Promise.all(pipesDrained).then(() => handleExit(state, { code, signal, logStream }));
  };

  child.on("error", (err) => {
    logStream.write(`[supervisor] ${state.spec.name} failed to spawn: ${err.message}\n`);
    settleOnce(null, null);
  });
  child.on("exit", (code, signal) => settleOnce(code, signal));
}

function clearSteadyTimer(state: SupervisionState): void {
  if (state.steadyTimer) {
    clearTimeout(state.steadyTimer);
    state.steadyTimer = null;
  }
}

/** Restarts the countdown to "this service has proven itself stable again". */
function restartSteadyTimer(state: SupervisionState): void {
  clearSteadyTimer(state);
  state.steadyTimer = setTimeout(() => {
    state.steadyTimer = null;
    state.restartCount = 0;
  }, state.restartPolicy.steadyUptimeMs);
}

/** Dispatch a child's exit: a clean/requested stop, a restart, or a terminal crash. */
function handleExit(state: SupervisionState, info: ExitInfo): void {
  const isCrash = !state.stopped && (info.code !== 0 || info.signal !== null);
  if (!isCrash) {
    info.logStream.end();
    state.untap();
    state.bus.emit({ type: "stopped", service: state.spec.name });
    return;
  }
  if (state.hasBeenHealthy && state.restartCount < state.restartPolicy.maxRestarts) {
    scheduleRestart(state, info);
    return;
  }
  emitCrashed(state, info);
}

/** Announce the crash, back off, then relaunch, budget permitting. */
function scheduleRestart(state: SupervisionState, { code, signal, logStream }: ExitInfo): void {
  state.restartCount += 1;
  const attempt = state.restartCount;
  const delayMs =
    state.restartPolicy.backoffMs[Math.min(attempt, state.restartPolicy.backoffMs.length) - 1] ??
    1_000;
  logStream.write(
    `[supervisor] ${state.spec.name} exited (${exitCause({ code, signal })}), restarting in ${delayMs}ms (attempt ${attempt}/${state.restartPolicy.maxRestarts})\n`,
  );
  logStream.end();
  state.bus.emit({
    type: "restarting",
    service: state.spec.name,
    code: code ?? -1,
    signal: signal ?? undefined,
    attempt,
    maxAttempts: state.restartPolicy.maxRestarts,
    delayMs,
  });
  state.backoffTimer = setTimeout(() => {
    state.backoffTimer = null;
    if (state.stopped) return;
    spawnAttempt(state);
  }, delayMs);
}

/** Restart budget exhausted (or the service never reached healthy): today's terminal behavior. */
function emitCrashed(state: SupervisionState, { code, signal, logStream }: ExitInfo): void {
  const reason = state.hasBeenHealthy ? "restart budget exhausted" : "died before first healthy";
  logStream.write(
    `[supervisor] ${state.spec.name} exited (${exitCause({ code, signal })}), ${reason}, not restarting\n`,
  );
  logStream.end();
  state.untap();
  state.bus.emit({
    type: "crashed",
    service: state.spec.name,
    code: code ?? -1,
    signal: signal ?? undefined,
  });
}

async function stopSupervised(state: SupervisionState): Promise<void> {
  if (state.stopped) return;
  state.stopped = true;
  state.untap();
  if (state.backoffTimer) {
    // The child already exited and a respawn is pending: cancel it. No
    // process is running, so this is the service's terminal event.
    clearTimeout(state.backoffTimer);
    state.backoffTimer = null;
    clearSteadyTimer(state);
    state.bus.emit({ type: "stopped", service: state.spec.name });
    return;
  }
  clearSteadyTimer(state);
  await killWithEscalation(state.currentChild);
}

async function killWithEscalation(child: ChildProcess): Promise<void> {
  const hasExited = child.exitCode !== null || child.signalCode !== null;
  if (hasExited || !child.pid || child.killed) return;
  child.kill("SIGTERM");
  const exited = await waitForExit(child, 10_000);
  if (exited) return;
  child.kill("SIGKILL");
  await waitForExit(child, 5_000);
}

function pipeLines(
  child: ChildProcess,
  streamName: "stdout" | "stderr",
  service: ServiceName,
  logStream: WriteStream,
  bus: EventBus,
): Promise<void> {
  const stream = child[streamName];
  if (!stream) return Promise.resolve();
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    logStream.write(`${line}\n`);
    bus.emit({ type: "log", service, stream: streamName, line });
  });
  // Resolve when readline finishes draining the pipe (stream EOF). The
  // child's 'exit' handler awaits this before closing the logStream so
  // the last lines aren't truncated.
  return new Promise<void>((resolve) => rl.once("close", () => resolve()));
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}
