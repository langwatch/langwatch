// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import process from "node:process";
import { startStandaloneApi } from "@langwatch/platform-api";
import { startStandaloneWorker } from "@langwatch/worker";
import { drainBackend, startBackend, type BackendHalves } from "./backend.process.ts";

/**
 * The `backend` lane: the API application and the worker application in one
 * Node process, for local development only (ADR-004, amendment 2026-09-07).
 *
 * It is a launcher, not a process role. Neither application learns that it is
 * sharing a process: each still resolves its own secrets, parses its own
 * configuration, composes its own graph and serves its own health and metrics
 * endpoints, in the same order it does when it runs alone. `WORKERS_IN_PROCESS`
 * and `START_WORKERS` stay dead — nothing here reads either, and no value of
 * either changes what this file starts.
 *
 * Production is untouched: it runs `apps/api`'s and `apps/worker`'s own
 * entrypoints as separate deployments, and neither imports this.
 */
const SHUTDOWN_DEADLINE_MS = 20_000;

const write = (line: string): void => void process.stderr.write(line);

let halves: BackendHalves | undefined;
let stopping: Promise<void> | undefined;

const stop = (code: number): Promise<void> => {
  stopping ??= (async () => {
    const deadline = setTimeout(() => {
      write("[langwatch:backend] shutdown outlived its deadline; exiting\n");
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    try {
      if (halves) await drainBackend(halves);
      process.exitCode = code;
    } catch (error) {
      write(`[langwatch:backend] shutdown failed: ${String(error)}\n`);
      process.exitCode = 1;
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
  write(`[langwatch:backend] uncaught exception: ${String(error.stack ?? error)}\n`);
  void stop(1);
});
process.on("unhandledRejection", (reason) => {
  write(`[langwatch:backend] unhandled rejection: ${String(reason)}\n`);
  void stop(1);
});

void startBackend({
  env: process.env,
  write,
  // A hosted application asking to exit is a fatal it could not recover from.
  // It reaches the one shutdown this process owns instead of ending the
  // process underneath the other half.
  fail: (code) => void stop(code === 0 ? 1 : code),
  startWorker: (host) => startStandaloneWorker({ host }),
  startApi: (host) => startStandaloneApi({ host }),
})
  .then((started) => {
    halves = started;
  })
  .catch(() => {
    process.exitCode = 1;
  });
