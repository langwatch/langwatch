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
import { clearTimeout, setTimeout } from "node:timers";

import { nowInstant } from "@langwatch/time";

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
  /** True once the supervisor gave up on it: it died before healthy or spent its restarts. */
  readonly crashed: boolean;
  stop(): Promise<void>;
};

export type RestartPolicy = {
  /** Restarts granted to a service that crashes after having been healthy. */
  maxRestarts: number;
  /** Delay before each restart attempt. Last entry repeats if list is short. */
  backoffMs: readonly number[];
  /** Uptime after which the restart counter resets to zero. */
  steadyUptimeMs: number;
};

/** Windows has no process groups to signal; there the child alone is stopped, as before. */
const OWN_PROCESS_GROUP = process.platform !== "win32";

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
  crashed: boolean;
  hasBeenHealthy: boolean;
  restartCount: number;
  backoffTimer: NodeJS.Timeout | null;
  steadyTimer: NodeJS.Timeout | null;
  untap: () => void;
};

// Every supervisor still running, in launch order, so a shutdown during boot
// reaches the children whose start helper has not returned a handle yet.
const running = new Set<SupervisionState>();
// Set by the stop: a start still awaiting its step (initdb, a predep) launches nothing after it.
let isStopping = false;

/** A launch asked for after the stop began; the boot that asked for it fails instead. */
export class SupervisionStoppedError extends Error {
  readonly code = "supervision_stopped";
  constructor(name: string) {
    super(`not starting ${name}: LangWatch is stopping`);
    this.name = "SupervisionStoppedError";
  }
}

/** Stops every supervised service still running, the last launched first; none starts after. */
export async function stopEverySupervised(): Promise<void> {
  isStopping = true;
  for (const state of [...running].reverse()) {
    await stopSupervised(state);
  }
}

// Supervise a child process. Tee stdout/stderr to log file, emit log events
// on bus. Crash policy: boot failure before healthy, retried with backoff after.
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
  if (isStopping) throw new SupervisionStoppedError(spec.name);
  const logPath = paths.log(spec.name);
  const pidPath = paths.pid(spec.name);
  mkdirSync(dirname(logPath), { recursive: true });
  mkdirSync(dirname(pidPath), { recursive: true });

  const first = launchAttempt({ spec, logPath });
  const state = makeSupervisionState({
    spec,
    bus,
    restartPolicy,
    logPath,
    pidPath,
    firstChild: first.child,
  });
  superviseAttempt(state, first);
  running.add(state);

  return {
    name: spec.name,
    get pid() {
      return state.currentChild.pid ?? -1;
    },
    get child() {
      return state.currentChild;
    },
    get crashed() {
      return state.crashed;
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
  firstChild,
}: {
  spec: SpawnSpec;
  bus: EventBus;
  restartPolicy: RestartPolicy;
  logPath: string;
  pidPath: string;
  firstChild: ChildProcess;
}): SupervisionState {
  const state: SupervisionState = {
    spec,
    bus,
    restartPolicy,
    logPath,
    pidPath,
    currentChild: firstChild,
    stopped: false,
    crashed: false,
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

type Attempt = Readonly<{ child: ChildProcess; logStream: WriteStream }>;

/** Opens the service's log and starts one child process. */
function launchAttempt({ spec, logPath }: { spec: SpawnSpec; logPath: string }): Attempt {
  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = nodeSpawn(spec.command, spec.args, {
    env: spec.env,
    cwd: spec.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so a stop reaches what a wrapper (pnpm, sh) started under it.
    detached: OWN_PROCESS_GROUP,
  });
  return { child, logStream };
}

/** Relaunch on restart: a fresh child becomes the current one and is supervised. */
function spawnAttempt(state: SupervisionState): void {
  const attempt = launchAttempt({ spec: state.spec, logPath: state.logPath });
  state.currentChild = attempt.child;
  superviseAttempt(state, attempt);
}

/** Records the child's pid, pipes its output, and wires its termination to `handleExit`. */
function superviseAttempt(state: SupervisionState, { child, logStream }: Attempt): void {
  if (typeof child.pid === "number") {
    writeFileSync(state.pidPath, String(child.pid));
  }

  // Track stdout/stderr "end" so buffered lines drain BEFORE closing the
  // log file — ending it synchronously on child 'exit' can lose the tail
  // chunk still flushing through readline (spawn.integration.test's
  // flaky 'row-2' assertion).
  const pipesDrained: Promise<void>[] = [
    pipeLines({ child, streamName: "stdout", service: state.spec.name, logStream, bus: state.bus }),
    pipeLines({ child, streamName: "stderr", service: state.spec.name, logStream, bus: state.bus }),
  ];

  restartSteadyTimer(state);
  wireChildTermination({ state, child, logStream, pipesDrained });
}

// Wire child termination. Both exit and spawn error funnel to handleExit.
function wireChildTermination({
  state,
  child,
  logStream,
  pipesDrained,
}: {
  state: SupervisionState;
  child: ChildProcess;
  logStream: WriteStream;
  pipesDrained: Promise<void>[];
}): void {
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
  running.delete(state);
  state.crashed = true;
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
  running.delete(state);
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
  if (!OWN_PROCESS_GROUP) {
    const hasExited = child.exitCode !== null || child.signalCode !== null;
    if (hasExited || !child.pid || child.killed) return;
    child.kill("SIGTERM");
    if (await waitForExit(child, 10_000)) return;
    child.kill("SIGKILL");
    await waitForExit(child, 5_000);
    return;
  }
  const group = child.pid;
  if (!group || !isGroupAlive(group)) return;
  signalGroup(group, "SIGTERM");
  if (await waitForGroupExit(group, 10_000)) return;
  signalGroup(group, "SIGKILL");
  await waitForGroupExit(group, 5_000);
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal);
  } catch {
    // The group is already gone.
  }
}

function isGroupAlive(group: number): boolean {
  try {
    process.kill(-group, 0);
    return true;
  } catch (err) {
    // EPERM: a member exists that this process may not signal; it is still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Waits until no process is left in the group: the wrapper and everything it started. */
async function waitForGroupExit(group: number, timeoutMs: number): Promise<boolean> {
  const deadline = nowInstant().epochMilliseconds + timeoutMs;
  while (nowInstant().epochMilliseconds < deadline) {
    if (!isGroupAlive(group)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isGroupAlive(group);
}

function pipeLines({
  child,
  streamName,
  service,
  logStream,
  bus,
}: {
  child: ChildProcess;
  streamName: "stdout" | "stderr";
  service: ServiceName;
  logStream: WriteStream;
  bus: EventBus;
}): Promise<void> {
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
