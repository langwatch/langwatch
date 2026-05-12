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

  // Track stdout + stderr "end" events so we can drain any buffered lines
  // BEFORE closing the log file. If we end() the logStream synchronously
  // on child 'exit', the readline transformer may still be flushing the
  // last chunk and we lose tail data — caught by spawn.integration.test
  // intermittently failing on the 'row-2' assertion. Wait for both pipes
  // to finish before closing.
  const pipesDrained: Promise<void>[] = [
    pipeLines(child, "stdout", spec.name, logStream, bus),
    pipeLines(child, "stderr", spec.name, logStream, bus),
  ];

  let stopped = false;
  let exited = false;

  child.on("exit", (code, signal) => {
    exited = true;
    safeUnlink(pidPath);

    void Promise.all(pipesDrained).then(() => {
      logStream.end();
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
