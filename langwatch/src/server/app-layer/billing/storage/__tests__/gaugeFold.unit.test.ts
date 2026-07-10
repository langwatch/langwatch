import { describe, expect, it } from "vitest";

import { foldBoundaryEvents } from "../gaugeFold";

const GIB = 1024n * 1024n * 1024n;

describe("foldBoundaryEvents()", () => {
  describe("when an entry event is folded into an existing gauge", () => {
    /** @scenario Entry events increase the gauge by their bytes */
    it("increases the gauge by the entry's bytes", () => {
      expect(
        foldBoundaryEvents({
          initialBytes: 10n * GIB,
          events: [{ deltaBytes: 2n * GIB }],
        }),
      ).toEqual(12n * GIB);
    });
  });

  describe("when an exit event is folded into an existing gauge", () => {
    /** @scenario Exit events decrease the gauge by their bytes */
    it("decreases the gauge by the exit's bytes", () => {
      expect(
        foldBoundaryEvents({
          initialBytes: 10n * GIB,
          events: [{ deltaBytes: -3n * GIB }],
        }),
      ).toEqual(7n * GIB);
    });
  });

  describe("when no events exist", () => {
    it("returns the initial gauge unchanged", () => {
      expect(foldBoundaryEvents({ initialBytes: 0n, events: [] })).toEqual(0n);
    });
  });

  describe("when signed deltas transiently exceed the gauge", () => {
    it("lets the fold go negative — clamping happens at sampling, never here", () => {
      expect(
        foldBoundaryEvents({
          initialBytes: 1n * GIB,
          events: [{ deltaBytes: -2n * GIB }],
        }),
      ).toEqual(-1n * GIB);
    });
  });
});
