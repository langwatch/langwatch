// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import { bootNodeExecutable } from "@langwatch/observability";

import type * as BackendEntry from "./backend.entrypoint.main.ts";

let entry: typeof BackendEntry | undefined;

/** Dynamic import lets fatal handlers cover ESM link failures in the entry's import graph. */
void bootNodeExecutable(
  "langwatch-backend",
  async () => {
    entry = await import("./backend.entrypoint.main.ts");
    await entry.bootBackendEntry();
  },
  // A crash after boot drains both halves; one before the entry loaded has nothing to drain.
  { onFatal: () => (entry ? entry.drainAfterCrash() : process.exit(1)) },
);
