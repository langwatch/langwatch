import { describe, expect, it } from "vitest";
import {
  isManualRun,
  mintManualRunId,
  mintScheduledRunId,
  runIsNewer,
  runRank,
} from "./runIdentity";

describe("runIdentity", () => {
  describe("given a scheduled run id", () => {
    it("mints the compact ISO shape", () => {
      const id = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      expect(id).toBe("20260717T093000");
    });

    it("ranks it as the instant it encodes", () => {
      const slot = Date.UTC(2026, 6, 17, 9, 30, 0);
      expect(runRank(mintScheduledRunId(slot))).toBe(slot);
    });

    it("is not a manual run", () => {
      expect(isManualRun(mintScheduledRunId(Date.UTC(2026, 6, 17)))).toBe(
        false,
      );
    });
  });

  describe("given a manual run id", () => {
    it("mints the manual- prefixed shape", () => {
      expect(mintManualRunId(1700000000000)).toBe("manual-1700000000000");
    });

    it("ranks it as the millisecond it encodes", () => {
      expect(runRank(mintManualRunId(1700000000000))).toBe(1700000000000);
    });

    it("is a manual run", () => {
      expect(isManualRun(mintManualRunId(1700000000000))).toBe(true);
    });
  });

  describe("given a run id in neither minted shape", () => {
    it("has no rank", () => {
      expect(runRank("not-a-run-id")).toBeNull();
      expect(runRank("")).toBeNull();
    });
  });

  describe("runIsNewer", () => {
    /** @scenario Each project keeps a stable daily slot spread across the fleet */
    it("ranks a later scheduled slot as newer than an earlier one", () => {
      const earlier = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const later = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      expect(runIsNewer(later, earlier)).toBe(true);
      expect(runIsNewer(earlier, later)).toBe(false);
    });

    it("ranks a later manual run as newer regardless of arrival order", () => {
      const earlier = mintManualRunId(1700000000000);
      const later = mintManualRunId(1700000005000);
      expect(runIsNewer(later, earlier)).toBe(true);
      expect(runIsNewer(earlier, later)).toBe(false);
    });

    it("ranks a manual run against a scheduled run purely by instant", () => {
      const scheduled = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const earlierManual = mintManualRunId(Date.UTC(2026, 6, 17, 8, 0, 0));
      const laterManual = mintManualRunId(Date.UTC(2026, 6, 17, 10, 0, 0));
      expect(runIsNewer(scheduled, earlierManual)).toBe(true);
      expect(runIsNewer(scheduled, laterManual)).toBe(false);
    });

    it("is never newer than itself", () => {
      const id = mintManualRunId(1700000000000);
      expect(runIsNewer(id, id)).toBe(false);
    });

    it("prefers the rankable id when exactly one side is unparseable", () => {
      const real = mintManualRunId(1700000000000);
      expect(runIsNewer(real, "garbage")).toBe(true);
      expect(runIsNewer("garbage", real)).toBe(false);
    });

    it("falls back to a deterministic total order when both ids are unparseable", () => {
      expect(runIsNewer("b-garbage", "a-garbage")).toBe(true);
      expect(runIsNewer("a-garbage", "b-garbage")).toBe(false);
      // Total and antisymmetric: never both, never neither, for a genuine pair.
      expect(runIsNewer("x", "y")).toBe(!runIsNewer("y", "x"));
    });
  });
});
