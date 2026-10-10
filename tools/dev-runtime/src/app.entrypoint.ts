// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import { bootNodeExecutable } from "@langwatch/observability";

import type * as AppEntry from "./app.entrypoint.main.ts";

let entry: typeof AppEntry | undefined;

/** Dynamic import lets fatal handlers cover ESM link failures in the host's own graph. */
void bootNodeExecutable(
  "langwatch-app",
  async () => {
    entry = await import("./app.entrypoint.main.ts");
    await entry.bootApp();
  },
  // A crash after boot drains the backend; one before the entry loaded has nothing to drain.
  { onFatal: () => (entry ? entry.stopAfterCrash() : process.exit(1)) },
);
