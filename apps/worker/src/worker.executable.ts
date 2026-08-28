import process from "node:process";
import type { ProcessObservabilityOptions } from "@langwatch/observability/node";
import { WorkerSignalHandlers, type WorkerSignalSource } from "./platform/lifecycle/worker.signals";
import {
  bootWorker,
  type WorkerProcess,
  type WorkerProcessComposition,
  type WorkerProcessFactoryContext,
} from "./worker.process";

export abstract class WorkerExecutableCompositionPort {
  abstract compose(
    context: WorkerProcessFactoryContext,
  ): WorkerProcessComposition | Promise<WorkerProcessComposition>;
}

export interface WorkerExecutableHost extends WorkerSignalSource {
  onUncaughtException(listener: (error: Error) => void): void;
  offUncaughtException(listener: (error: Error) => void): void;
  onUnhandledRejection(listener: (reason: unknown, promise: Promise<unknown>) => void): void;
  offUnhandledRejection(listener: (reason: unknown, promise: Promise<unknown>) => void): void;
  exit(code: number): void;
}

export type WorkerExecutableOptions = Readonly<{
  source: Readonly<Record<string, unknown>>;
  composition: WorkerExecutableCompositionPort;
  observability?: Omit<ProcessObservabilityOptions, "serviceName" | "loggerName">;
  host?: WorkerExecutableHost;
}>;

/**
 * Physical Worker executable boundary.
 *
 * Hosts inject only the application graph they still need to compose. This
 * class owns Worker configuration, structured logging, tracing, signal policy,
 * fatal-error reporting, and lifecycle finalization without importing the
 * legacy platform application.
 */
export class WorkerExecutable {
  static async boot(options: WorkerExecutableOptions): Promise<WorkerExecutable> {
    const host = options.host ?? nodeWorkerHost();
    const worker = await bootWorker({
      source: options.source,
      createComposition: (context) => options.composition.compose(context),
      observability: options.observability,
    });
    const executable = new WorkerExecutable(worker, host);
    executable.installHandlers();
    worker.logger.info("starting");
    return executable;
  }

  private readonly uncaughtException = (error: Error) => {
    this.worker.logger.fatal({ error }, "uncaught exception detected");
    this.host.exit(1);
  };

  private readonly unhandledRejection = (reason: unknown, promise: Promise<unknown>) => {
    this.worker.logger.fatal(
      { reason: reason instanceof Error ? reason : { value: reason }, promise },
      "unhandled rejection detected",
    );
    this.host.exit(1);
  };

  private closing: Promise<void> | undefined;
  private signals: WorkerSignalHandlers | undefined;

  private constructor(
    readonly worker: WorkerProcess,
    private readonly host: WorkerExecutableHost,
  ) {}

  start(): Promise<void> {
    return this.worker.start();
  }

  close(): Promise<void> {
    this.closing ??= this.closeExecutable();
    return this.closing;
  }

  private installHandlers(): void {
    this.signals = WorkerSignalHandlers.install({
      source: this.host,
      close: () => this.close(),
      logger: this.worker.logger,
      deadlineMs: this.worker.config.shutdown.processDeadlineMs,
      onDeadline: async () => {
        this.host.exit(1);
      },
      onComplete: async () => {
        this.host.exit(0);
      },
      onFailure: async () => {
        this.host.exit(1);
      },
    });
    this.host.onUncaughtException(this.uncaughtException);
    this.host.onUnhandledRejection(this.unhandledRejection);
  }

  private async closeExecutable(): Promise<void> {
    try {
      await this.worker.close();
    } finally {
      this.signals?.dispose();
      this.host.offUncaughtException(this.uncaughtException);
      this.host.offUnhandledRejection(this.unhandledRejection);
    }
  }
}

export function bootWorkerExecutable(options: WorkerExecutableOptions): Promise<WorkerExecutable> {
  return WorkerExecutable.boot(options);
}

function nodeWorkerHost(): WorkerExecutableHost {
  return {
    on: (signal, listener) => process.on(signal, listener),
    off: (signal, listener) => process.off(signal, listener),
    onUncaughtException: (listener) => process.on("uncaughtException", listener),
    offUncaughtException: (listener) => process.off("uncaughtException", listener),
    onUnhandledRejection: (listener) => process.on("unhandledRejection", listener),
    offUnhandledRejection: (listener) => process.off("unhandledRejection", listener),
    exit: (code) => process.exit(code),
  };
}
