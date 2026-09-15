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
 * The standalone worker: configuration, production graph, and signals. Config
 * failures throw early before observability exists.
 */
export async function startStandaloneWorker(
  options: WorkerStandaloneExecutableOptions = {},
): Promise<WorkerExecutable> {
  const host = options.host ?? nodeWorkerProcessHost();
  try {
    const worker = await WorkerExecutable.boot({
      source: host.env,
      composition: WorkerStandaloneComposition.create(),
      host,
    });
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
