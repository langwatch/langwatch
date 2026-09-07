#!/usr/bin/env tsx
import { withArchitectureLintSlot } from "./lint-queue.ts";

await withArchitectureLintSlot(async () => {
  await import("./cli-run.ts");
});
