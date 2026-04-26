import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { dirname } from "node:path";
import type { ServiceName, ServicePaths } from "./paths.ts";
import type { EventBus } from "./event-bus.ts";

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

/**
 * Spawn a child process under supervision: tee stdout/stderr to its log file
 * AND emit "log" events on the bus so the CLI can render to TTY. Writes a
 * pidfile so a stale process can be detected on the next CLI run.
 *
 * The returned handle's `stop()` sends SIGTERM, waits up to 10s for clean
 * exit, then SIGKILLs. Idempotent.
 */
export function supervise({
  spec,
  paths,
  bus,
}: {
  spec: SpawnSpec;
  paths: ServicePaths;
  bus: EventBus;
}): SupervisedHandle {
  const logPath = paths.log(spec.name);
  const pidPath = paths.pid(spec.name);
  mkdirSync(dirname(logPath), { recursive: true });
  mkdirSync(dirname(pidPath), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: "a" });

  const child = nodeSpawn(spec.command, spec.args, {
    env: spec.env,
    cwd: spec.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (typeof child.pid === "number") {
    writeFileSync(pidPath, String(child.pid));
  }

  pipeLines(child, "stdout", spec.name, logStream, bus);
  pipeLines(child, "stderr", spec.name, logStream, bus);

  let stopped = false;
  let exited = false;

  child.on("exit", (code, signal) => {
    exited = true;
    logStream.end();
    safeUnlink(pidPath);
    if (!stopped && (code !== 0 || signal !== null)) {
      bus.emit({
        type: "crashed",
        service: spec.name,
        code: code ?? -1,
        signal: signal ?? undefined,
      });
    } else {
      bus.emit({ type: "stopped", service: spec.name });
    }
  });

  const stop = async (): Promise<void> => {
    if (stopped || exited) return;
    stopped = true;
    if (!child.pid || child.killed) return;
    child.kill("SIGTERM");
    const exit = waitForExit(child, 10_000);
    if (await exit) return;
    child.kill("SIGKILL");
    await waitForExit(child, 5_000);
  };

  return { name: spec.name, pid: child.pid ?? -1, child, stop };
}

function pipeLines(
  child: ChildProcess,
  streamName: "stdout" | "stderr",
  service: ServiceName,
  logStream: WriteStream,
  bus: EventBus,
): void {
  const stream = child[streamName];
  if (!stream) return;
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    logStream.write(`${line}\n`);
    bus.emit({ type: "log", service, stream: streamName, line });
  });
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
