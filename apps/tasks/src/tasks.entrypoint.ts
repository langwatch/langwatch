// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import { bootNodeExecutable } from "@langwatch/observability";

/**
 * The runnable task process — `pnpm --filter @langwatch/tasks task <name>
 * [args]`, and the same words inside the container CMD: `pnpm -s task <name>`.
 *
 * The guard installs its fatal handlers before the real entry loads, because
 * a missing module deep in that entry's import graph fails at ESM link time,
 * before any code in it runs. The dynamic import below is a boot seam, the
 * one sanctioned inline `import()`.
 */
void bootNodeExecutable("langwatch-tasks", () =>
  import("./tasks.entrypoint.main.ts").then((m) => m.bootTasks()),
);
