import process from "node:process";

import { processFailureLine } from "@langwatch/observability";
import { startApi } from "@langwatch/platform-api";
import { startWorker } from "@langwatch/worker";

import {
  backendHalfOf,
  drainBackend,
  startBackend,
  BACKEND_HALF_SERVICE,
  type BackendHalves,
} from "./backend.process.ts";

/**
 * Local-only launcher for API and worker in one Node process.
 * Each app keeps its own composition; production still uses separate entrypoints.
 * See ADR-004, amendment 2026-09-07.
 */
const SHUTDOWN_DEADLINE_MS = 20_000;

const write = (line: string): void => void process.stderr.write(line);

/** The service name the launcher's own fatal records carry. */
const BACKEND_SERVICE = "langwatch-backend";

let halves: BackendHalves | undefined;
let stopping: Promise<void> | undefined;

const stop = (code: number): Promise<void> => {
  stopping ??= (async () => {
    const deadline = setTimeout(() => {
      write(
        processFailureLine({
          service: BACKEND_SERVICE,
          event: "shutdown outlived its deadline; exiting",
        }),
      );
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    try {
      if (halves) await drainBackend(halves);
      process.exitCode = code;
    } catch (error) {
      write(processFailureLine({ service: BACKEND_SERVICE, event: "shutdown failed", error }));
      process.exit(1);
    } finally {
      clearTimeout(deadline);
    }
  })();
  return stopping;
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void stop(0);
  });
}

process.on("uncaughtException", (error) => {
  write(processFailureLine({ service: BACKEND_SERVICE, event: "uncaught exception", error }));
  void stop(1);
});
process.on("unhandledRejection", (reason) => {
  write(
    processFailureLine({ service: BACKEND_SERVICE, event: "unhandled rejection", error: reason }),
  );
  void stop(1);
});

/** Boots both applications and reports whether they came up. Never re-throws. */
export function bootBackendEntry(): Promise<void> {
  // Neither half owns this process: the launcher takes the signals and drains
  // both, and startBackend decides which half sets telemetry up.
  return startBackend({ startWorker, startApi })
    .then((started) => {
      halves = started;
    })
    .catch((error) => {
      // Name the half that refused, then exit outright: a failed boot's own
      // pollers would hold the loop open, and a silent exit costs the diagnosis.
      const half = backendHalfOf(error);
      write(
        processFailureLine({
          service: half ? BACKEND_HALF_SERVICE[half] : BACKEND_SERVICE,
          event: "fatal boot failure",
          error,
        }),
      );
      process.exit(1);
    });
}
