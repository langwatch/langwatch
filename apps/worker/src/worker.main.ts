import process from "node:process";
import type { Logger } from "@langwatch/observability";
import { WorkerSignalHandlers, type WorkerSignalSource } from "./platform/lifecycle/worker.signals";
import { bootWorker, type WorkerBootOptions } from "./worker.process";

export type WorkerMainSignals =
  | false
  | {
      source?: WorkerSignalSource;
      exit?: (code: number) => void;
    };

export type WorkerMainOptions = WorkerBootOptions & {
  signals?: WorkerMainSignals;
};

/** The executable needs only the worker's lifecycle and structured logger. */
export type WorkerMainProcessPort = {
  readonly logger: Pick<Logger, "error" | "info">;
  start(): Promise<void>;
  close(): Promise<void>;
};

type WorkerMainCreateOptions = {
  worker: WorkerMainProcessPort;
  signals?: WorkerMainSignals;
};

/**
 * Injectable worker executable boundary. It owns process signal policy while
 * `WorkerProcess` retains the resource ordering needed by every host. The live
 * production executable switches here only with the complete Worker registry.
 */
export class WorkerMain {
  static async boot(options: WorkerMainOptions): Promise<WorkerMain> {
    const worker = await bootWorker(options);
    return WorkerMain.create({ worker, signals: options.signals });
  }

  static create(options: WorkerMainCreateOptions): WorkerMain {
    const main = new WorkerMain(options.worker);

    if (options.signals !== false) {
      const source = options.signals?.source ?? process;
      const exit = options.signals?.exit ?? process.exit.bind(process);
      main.signals = WorkerSignalHandlers.install({
        source,
        close: () => main.close(),
        logger: options.worker.logger,
        onComplete: async () => {
          exit(0);
        },
        onFailure: async () => {
          exit(1);
        },
      });
    }

    return main;
  }

  private closing: Promise<void> | undefined;
  private signals: WorkerSignalHandlers | undefined;

  private constructor(readonly worker: WorkerMainProcessPort) {}

  start(): Promise<void> {
    return this.worker.start();
  }

  close(): Promise<void> {
    this.closing ??= this.closeMain();
    return this.closing;
  }

  private async closeMain(): Promise<void> {
    try {
      await this.worker.close();
    } finally {
      this.signals?.dispose();
    }
  }
}

export async function bootWorkerMain(options: WorkerMainOptions): Promise<WorkerMain> {
  return WorkerMain.boot(options);
}
