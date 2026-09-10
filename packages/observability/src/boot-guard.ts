/**
 * The guard every Node executable installs before it loads its own real
 * entry. A missing module deep in that entry's import graph fails at ESM
 * link time, before any code in the entry file runs — so the handlers below
 * must not depend on that graph resolving first.
 */
import process from "node:process";
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
 * inline `import()` — a boot seam, not a lazy-loaded dependency. A
 * resolution failure there rejects instead of crashing before any handler
 * exists. Once the entry settles it will have installed its own long-lived
 * handlers (or already finished), so this guard's own listeners stand down.
 */
export async function bootNodeExecutable(service: string, load: () => Promise<unknown>): Promise<void> {
  const guard = installBootGuard(service);
  try {
    await load();
  } catch (error) {
    writeFatal(service, "fatal boot failure", error);
    process.exitCode = 1;
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
