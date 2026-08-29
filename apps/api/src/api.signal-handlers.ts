import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import type { Logger } from "@langwatch/observability";

export type ApiShutdownSignal = "SIGTERM" | "SIGINT";

export type ApiSignalHost = {
  on(signal: ApiShutdownSignal, listener: () => void): unknown;
  off?(signal: ApiShutdownSignal, listener: () => void): unknown;
};

export type ApiSignalHandlerOptions = {
  close(): Promise<void>;
  logger: Pick<Logger, "error" | "info">;
  host?: ApiSignalHost;
  exit?: (code: number) => void;
  /**
   * The wall-clock budget the whole shutdown sequence gets. A drain that
   * outlives it is a stuck process, not a slow one, so the deadline reports the
   * overrun and exits non-zero rather than waiting for an orchestrator kill.
   */
  deadlineMs?: number;
};

/**
 * Installs the API process's one signal boundary. The close operation is
 * shared between SIGTERM and SIGINT so duplicate delivery cannot begin a
 * second shutdown sequence over half-closed resources.
 */
export function installApiSignalHandlers(options: ApiSignalHandlerOptions): () => void {
  const host = options.host ?? process;
  const exit = options.exit ?? process.exit.bind(process);
  let closing: Promise<void> | undefined;
  let finished = false;

  const handleTerm = () => {
    handle("SIGTERM");
  };
  const handleInt = () => {
    handle("SIGINT");
  };
  const markFinished = () => {
    finished = true;
  };
  const isFinished = () => finished;
  const handle = (signal: ApiShutdownSignal) => {
    if (closing) return;
    const deadline = startShutdownDeadline({
      signal,
      deadlineMs: options.deadlineMs,
      logger: options.logger,
      onDeadline: () => finish({ code: 1, exit, finished: isFinished, markFinished }),
    });
    closing = closeForSignal({ signal, close: options.close, logger: options.logger });
    void closing.then(
      () => {
        deadline.clear();
        options.logger.info({ signal }, "API graceful shutdown complete");
        finish({ code: 0, exit, finished: isFinished, markFinished });
      },
      (error) => {
        deadline.clear();
        options.logger.error({ error, signal }, "API graceful shutdown failed");
        finish({ code: 1, exit, finished: isFinished, markFinished });
      },
    );
  };

  host.on("SIGTERM", handleTerm);
  host.on("SIGINT", handleInt);

  return () => {
    host.off?.("SIGTERM", handleTerm);
    host.off?.("SIGINT", handleInt);
  };
}

function startShutdownDeadline({
  signal,
  deadlineMs,
  logger,
  onDeadline,
}: {
  signal: ApiShutdownSignal;
  deadlineMs: number | undefined;
  logger: Pick<Logger, "error">;
  onDeadline(): void;
}): { clear(): void } {
  if (!deadlineMs || deadlineMs <= 0) return { clear: () => void 0 };

  const timer = setTimeout(() => {
    logger.error({ signal, deadlineMs }, "API graceful shutdown exceeded its deadline");
    onDeadline();
  }, deadlineMs);
  timer.unref();
  return {
    clear: () => {
      clearTimeout(timer);
    },
  };
}

async function closeForSignal({
  signal,
  close,
  logger,
}: {
  signal: ApiShutdownSignal;
  close(): Promise<void>;
  logger: Pick<Logger, "info">;
}): Promise<void> {
  logger.info({ signal }, "API received shutdown signal");
  await close();
}

function finish({
  code,
  exit,
  finished,
  markFinished,
}: {
  code: number;
  exit: (code: number) => void;
  finished(): boolean;
  markFinished(): void;
}): void {
  if (finished()) return;
  markFinished();
  exit(code);
}
