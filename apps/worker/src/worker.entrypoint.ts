// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import { bootNodeExecutable } from "@langwatch/observability";

/**
 * The runnable worker process — `pnpm --filter @langwatch/worker start`.
 *
 * The guard installs its fatal handlers before the real entry loads, because
 * a missing module deep in that entry's import graph fails at ESM link time,
 * before any code in it runs. The dynamic import below is a boot seam, the
 * one sanctioned inline `import()`.
 */
void bootNodeExecutable("langwatch-worker", () =>
  import("./worker.entrypoint.main.ts").then((m) => m.bootWorkerEntry()),
);
