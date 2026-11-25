import { describe, expect, it } from "vitest";

import { blobCleanupStateSchema } from "../blob-cleanup.process.ts";
import { processRetentionSweepStateSchema } from "../process-retention-sweep.process.ts";

describe("process state stored by the main release", () => {
  it("parses a blob cleanup state as main stored it", () => {
    expect(blobCleanupStateSchema.parse({ lastSweepAt: null })).toEqual({ lastSweepAt: null });
  });
  it("parses a retention sweep state as main stored it", () => {
    expect(
      processRetentionSweepStateSchema.parse({
        lastSweepAt: 1_760_000_000_000,
        sweepsScheduled: 3,
      }),
    ).toEqual({ lastSweepAt: 1_760_000_000_000, sweepsScheduled: 3 });
  });
});
