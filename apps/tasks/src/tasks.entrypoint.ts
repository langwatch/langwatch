// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import { bootNodeExecutable } from "@langwatch/observability";

// Guard installs fatal handlers before entry loads. Dynamic import boot seam.
void bootNodeExecutable("langwatch-tasks", () =>
  import("./tasks.entrypoint.main.ts").then((m) => m.bootTasks()),
);
