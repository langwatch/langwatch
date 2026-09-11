import process from "node:process";
import { processFailureLine } from "@langwatch/observability";
import { WorkerExecutable, type WorkerExecutableHost } from "../worker.executable.ts";
import { WorkerStandaloneComposition } from "./worker-standalone.composition.ts";

/**
 * The Node process surface the standalone executable needs, injectable for
 * tests.
 *
 * It is the executable's ONE seam onto the process, so a test can drive a boot
 * failure and a signal without touching the real `process`, and a host that
 * embeds this can remove every handler it installed.
 */
export type WorkerExecutableProcessHost = WorkerExecutableHost & {
  env: Readonly<Record<string, unknown>>;
  write(line: string): void;
};

export type WorkerStandaloneExecutableOptions = Readonly<{
  host?: WorkerExecutableProcessHost;
}>;

/**
 * The physical worker executable: one table of what this process is made of.
 *
 *   source      the process's environment, read once and validated once
 *   composition {@link WorkerStandaloneComposition} — the production graph,
 *               which opens its own Postgres, ClickHouse, Redis, AWS and
 *               stored-object runtimes and mounts the complete job registry
 *   signals     SIGTERM and SIGINT, the shutdown deadline, and the exit status
 *               each one produces — all `WorkerExecutable`'s
 *
 * A configuration failure throws out of `boot` before observability or the
 * resource scope exist, which is what makes a misconfigured worker refuse to
 * start rather than come up green with every job failing individually. The
 * failure is written where an operator reads it, and the exit status is
 * non-zero.
 *
 * It imports no legacy application graph, so it cannot start a partial second
 * copy of the platform process.
 */
export async function startStandaloneWorker(
  options: WorkerStandaloneExecutableOptions = {},
): Promise<WorkerExecutable> {
  const host = options.host ?? nodeWorkerProcessHost();
  try {
    const worker = await WorkerExecutable.boot();
    await worker.start();
    worker.worker.logger.info(
      { metricsPort: worker.worker.config.liveness.metricsPort },
      "worker ready",
    );
    return worker;
  } catch (error) {
    host.write(processFailureLine({ service: "langwatch-worker", event: "fatal boot failure", error }));
    throw error;
  }
}

function nodeWorkerProcessHost(): WorkerExecutableProcessHost {
  return {
    env: process.env,
    on: (signal, listener) => process.on(signal, listener),
    off: (signal, listener) => process.off(signal, listener),
    onUncaughtException: (listener) => process.on("uncaughtException", listener),
    offUncaughtException: (listener) => process.off("uncaughtException", listener),
    onUnhandledRejection: (listener) => process.on("unhandledRejection", listener),
    offUnhandledRejection: (listener) => process.off("unhandledRejection", listener),
    exit: (code) => process.exit(code),
    write: (line) => void process.stderr.write(line),
  };
}
