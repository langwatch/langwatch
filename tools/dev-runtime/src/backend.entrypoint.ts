// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import { bootNodeExecutable } from "@langwatch/observability";

/** Dynamic import lets fatal handlers cover ESM link failures in the entry's import graph. */
void bootNodeExecutable("langwatch-backend", () =>
  import("./backend.entrypoint.main.ts").then((m) => m.bootBackendEntry()),
);
