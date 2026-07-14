import { describe, expect, it } from "vitest";

import { settleWindowBucket } from "../settleWindow";

describe("settle window bucket", () => {
  describe("given activity uses one debounce configuration", () => {
    it("keeps duplicate activity in one bucket and re-arms in a later bucket", () => {
      expect(
        settleWindowBucket({ occurredAt: 1_000, traceDebounceMs: 30_000 }),
      ).toBe("30000-0");
      expect(
        settleWindowBucket({ occurredAt: 2_000, traceDebounceMs: 30_000 }),
      ).toBe("30000-0");
      expect(
        settleWindowBucket({ occurredAt: 31_000, traceDebounceMs: 30_000 }),
      ).toBe("30000-1");
    });
  });

  describe("given debounce is disabled", () => {
    it("collapses exact redelivery and re-arms in the next millisecond", () => {
      expect(
        settleWindowBucket({ occurredAt: 1_000, traceDebounceMs: 0 }),
      ).toBe("0-1000");
      expect(
        settleWindowBucket({ occurredAt: 1_000, traceDebounceMs: 0 }),
      ).toBe("0-1000");
      expect(
        settleWindowBucket({ occurredAt: 1_001, traceDebounceMs: 0 }),
      ).toBe("0-1001");
    });
  });

  describe("given the debounce configuration changes between rounds", () => {
    it("keeps equal bucket indexes isolated by their configured width", () => {
      expect(
        settleWindowBucket({ occurredAt: 61_000, traceDebounceMs: 30_000 }),
      ).toBe("30000-2");
      expect(
        settleWindowBucket({ occurredAt: 121_000, traceDebounceMs: 60_000 }),
      ).toBe("60000-2");
    });
  });
});
