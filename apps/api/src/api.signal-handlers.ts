import process from "node:process";
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
  const handle = (signal: ApiShutdownSignal) => {
    closing ??= closeForSignal({ signal, close: options.close, logger: options.logger });
    void closing.then(
      () =>
        finish({ code: 0, exit, finished: () => finished, markFinished: () => (finished = true) }),
      (error) => {
        options.logger.error({ error, signal }, "API graceful shutdown failed");
        finish({ code: 1, exit, finished: () => finished, markFinished: () => (finished = true) });
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
