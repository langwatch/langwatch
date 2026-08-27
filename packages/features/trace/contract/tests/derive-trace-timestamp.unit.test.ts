import { describe, expect, it } from "vitest";
import { deriveTraceTimestamp } from "../src/derive-trace-timestamp";

describe("deriveTraceTimestamp", () => {
  it("uses the span timing baseline when present", () => {
    expect(deriveTraceTimestamp({ occurredAt: 1_700_000_000_000, storageAnchorMs: 42 })).toBe(
      1_700_000_000_000,
    );
  });

  it("falls back to the storage anchor for log-only traces", () => {
    expect(deriveTraceTimestamp({ occurredAt: 0, storageAnchorMs: 42 })).toBe(42);
    expect(deriveTraceTimestamp({ occurredAt: 0, storageAnchorMs: null })).toBe(0);
    expect(deriveTraceTimestamp({ occurredAt: 0 })).toBe(0);
  });
});
