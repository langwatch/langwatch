import process from "node:process";
import { startStandaloneWorker } from "./app/worker-standalone.executable.ts";

// Boot failures are already reported to stderr; exit non-zero to prevent double-reporting.
export function bootWorkerEntry(): Promise<void> {
  return startStandaloneWorker().catch(() => {
    // Exit outright: pollers a half-built graph already started would
    // otherwise hold the event loop open, spinning on closed clients.
    process.exit(1);
  });
}
