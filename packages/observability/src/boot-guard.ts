import { nowInstant } from "@langwatch/time";

/**
 * The guard every Node executable installs before loading its real entry.
 * A missing module deep in that graph fails at ESM link time, before any
 * entry code runs — so the handlers below can't depend on it resolving first.
 */
import { processFailureLine } from "./run-script.ts";

/** Fatal handlers a process must have before its real entry point loads. */
export function installBootGuard(
  service: string,
  { onFatal }: { onFatal?: () => void } = {},
): { dispose(): void; disposeWarnings(): void } {
  const fatal = (event: string, error: unknown) => {
    writeFatal(service, event, error);
    if (onFatal) onFatal();
    else process.exit(1);
  };
  const uncaughtException = (error: unknown) => fatal("uncaught exception", error);
  const unhandledRejection = (reason: unknown) => fatal("unhandled rejection", reason);
  const warning = (warning: unknown) => {
    process.stderr.write(
      processFailureLine({ service, event: "warning", error: warning, level: "warn" }),
    );
  };
  process.on("uncaughtException", uncaughtException);
  process.on("unhandledRejection", unhandledRejection);
  process.on("warning", warning);
  const disposeWarnings = () => {
    process.off("warning", warning);
  };
  return {
    dispose: () => {
      process.off("uncaughtException", uncaughtException);
      process.off("unhandledRejection", unhandledRejection);
      disposeWarnings();
    },
    disposeWarnings,
  };
}

/**
 * Loads the entry under the guard. With `onFatal`, a long-running process keeps the crash
 * handlers after boot and a crash calls `onFatal` (its drain) instead of exiting on the spot.
 */
export async function bootNodeExecutable(
  service: string,
  load: () => Promise<unknown>,
  { onFatal }: { onFatal?: () => void } = {},
): Promise<void> {
  const guard = installBootGuard(service, { onFatal });
  try {
    await load();
  } catch (error) {
    writeFatal(service, "fatal boot failure", error);
    // Exit outright: pollers a half-built graph already started would
    // otherwise hold the event loop open forever, spinning on closed clients.
    process.exit(1);
  } finally {
    if (onFatal) guard.disposeWarnings();
    else guard.dispose();
  }
}

function writeFatal(service: string, event: string, error: unknown): void {
  try {
    process.stderr.write(processFailureLine({ service, event, error }));
  } catch {
    process.stderr.write(
      `${JSON.stringify({
        level: "fatal",
        time: nowInstant().toString({ fractionalSecondDigits: 3 }),
        service,
        msg: event,
        error: { type: typeof error, message: String(error) },
      })}\n`,
    );
  }
}
