import type { Logger } from "@langwatch/observability";

export const WORKER_SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;
export type WorkerShutdownSignal = (typeof WORKER_SHUTDOWN_SIGNALS)[number];

export interface WorkerSignalSource {
  on(signal: WorkerShutdownSignal, listener: () => void): void;
  off(signal: WorkerShutdownSignal, listener: () => void): void;
}

/**
 * Installs the worker's one idempotent shutdown boundary.
 *
 * The source is a port so tests and supervisors can exercise signal handling
 * without mutating the host process. The required failure callback is the
 * executable's explicit exit-status policy; this library never calls exit.
 */
export class WorkerSignalHandlers {
  static install(options: {
    source: WorkerSignalSource;
    close: () => Promise<void>;
    logger?: Pick<Logger, "error" | "info">;
    onComplete?: (signal: WorkerShutdownSignal) => void | Promise<void>;
    onFailure: (error: unknown, signal: WorkerShutdownSignal) => void | Promise<void>;
  }): WorkerSignalHandlers {
    const handlers = new WorkerSignalHandlers(
      options.source,
      options.close,
      options.logger,
      options.onComplete,
      options.onFailure,
    );
    handlers.install();
    return handlers;
  }

  private readonly listeners = new Map<WorkerShutdownSignal, () => void>();
  private closing: Promise<void> | undefined;
  private disposed = false;

  private constructor(
    private readonly source: WorkerSignalSource,
    private readonly close: () => Promise<void>,
    private readonly logger: Pick<Logger, "error" | "info"> | undefined,
    private readonly onComplete:
      | ((signal: WorkerShutdownSignal) => void | Promise<void>)
      | undefined,
    private readonly onFailure: (
      error: unknown,
      signal: WorkerShutdownSignal,
    ) => void | Promise<void>,
  ) {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [signal, listener] of this.listeners) {
      this.source.off(signal, listener);
    }
    this.listeners.clear();
  }

  private install(): void {
    for (const signal of WORKER_SHUTDOWN_SIGNALS) {
      const listener = () => {
        this.closing ??= this.shutdown(signal).catch((error: unknown) => {
          this.logger?.error({ error, signal }, "worker shutdown failure policy failed");
        });
      };
      this.listeners.set(signal, listener);
      this.source.on(signal, listener);
    }
  }

  private async shutdown(signal: WorkerShutdownSignal): Promise<void> {
    this.logger?.info({ signal }, "worker shutdown requested");
    try {
      await this.close();
      this.logger?.info({ signal }, "worker shutdown complete");
      await this.onComplete?.(signal);
    } catch (error) {
      this.logger?.error({ error, signal }, "worker shutdown failed");
      await this.onFailure(error, signal);
    } finally {
      this.dispose();
    }
  }
}
