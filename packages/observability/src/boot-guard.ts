/**
 * The guard every Node executable installs before loading its real entry.
 * A missing module deep in that graph fails at ESM link time, before any
 * entry code runs — so the handlers below can't depend on it resolving first.
 */
import { processFailureLine } from "./run-script.ts";

/** Fatal handlers a process must have before its real entry point loads. */
export function installBootGuard(service: string): { dispose(): void } {
  const uncaughtException = (error: unknown) => {
    writeFatal(service, "uncaught exception", error);
    process.exit(1);
  };
  const unhandledRejection = (reason: unknown) => {
    writeFatal(service, "unhandled rejection", reason);
    process.exit(1);
  };
  const warning = (warning: unknown) => {
    writeFatal(service, "warning", warning);
  };
  process.on("uncaughtException", uncaughtException);
  process.on("unhandledRejection", unhandledRejection);
  process.on("warning", warning);
  return {
    dispose: () => {
      process.off("uncaughtException", uncaughtException);
      process.off("unhandledRejection", unhandledRejection);
      process.off("warning", warning);
    },
  };
}

/**
 * Installs the guard, then loads the real entry via the one sanctioned
 * inline `import()` — a boot seam, not lazy loading, so a failure rejects
 * rather than crashing pre-handler; dispose() then hands off to the entry's own handlers.
 */
export async function bootNodeExecutable(
  service: string,
  load: () => Promise<unknown>,
): Promise<void> {
  const guard = installBootGuard(service);
  try {
    await load();
  } catch (error) {
    writeFatal(service, "fatal boot failure", error);
    // Exit outright: pollers a half-built graph already started would
    // otherwise hold the event loop open forever, spinning on closed clients.
    process.exit(1);
  } finally {
    guard.dispose();
  }
}

function writeFatal(service: string, event: string, error: unknown): void {
  try {
    process.stderr.write(processFailureLine({ service, event, error }));
  } catch {
    process.stderr.write(
      `${JSON.stringify({
        level: "fatal",
        time: new Date().toISOString(),
        service,
        msg: event,
        error: { type: typeof error, message: String(error) },
      })}\n`,
    );
  }
}
