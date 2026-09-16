// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import { bootNodeExecutable } from "@langwatch/observability";

/**
 * The runnable worker process — `pnpm --filter @langwatch/worker start`.
 * The guard installs fatal handlers before the real entry loads, since a
 * missing module fails at ESM link time — the import below is a sanctioned boot seam.
 */
void bootNodeExecutable("langwatch-worker", () =>
  import("./worker.entrypoint.main.ts").then((m) => m.bootWorkerEntry()),
);
