import { describe, expect, it } from "vitest";
import { estimateFiringRate } from "../firingRate";

const immediate = (matchesLast7Days: number) =>
  estimateFiringRate({ matchesLast7Days, cadence: "immediate", batches: true });

describe("estimateFiringRate", () => {
  describe("when firing per match (immediate or persist)", () => {
    it("reports an hourly rate above ~24/day", () => {
      // 700 / 7 = 100/day ≈ 4/hour.
      expect(immediate(700)).toBe("About 4 times an hour at this rate");
    });

    it("reports a daily rate", () => {
      expect(immediate(70)).toBe("About 10 times a day at this rate");
    });

    it("singularises one a day", () => {
      expect(immediate(7)).toBe("About 1 time a day at this rate");
    });

    it("falls back to a weekly rate", () => {
      expect(immediate(3)).toBe("About 3 times a week at this rate");
    });

    it("singularises one a week", () => {
      expect(immediate(1)).toBe("About 1 time a week at this rate");
    });

    it("treats a persist action as per-match even off the immediate cadence", () => {
      // batches:false → cadence window is ignored, raw per-match rate.
      expect(
        estimateFiringRate({
          matchesLast7Days: 70,
          cadence: "hourly_digest",
          batches: false,
        }),
      ).toBe("About 10 times a day at this rate");
    });
  });

  describe("when a notify action batches on a digest cadence", () => {
    it("keeps the raw rate but notes the digest when matches are sparse", () => {
      // 42/7 = 6/day, well under 288 five-minute windows/day → unchanged rate.
      expect(
        estimateFiringRate({
          matchesLast7Days: 42,
          cadence: "5min_digest",
          batches: true,
        }),
      ).toBe("About 6 times a day, batched every 5 minutes");
    });

    it("caps the rate at the digest-window frequency for busy queries", () => {
      // 7000/7 = 1000/day, but an hourly digest can fire at most 24/day.
      expect(
        estimateFiringRate({
          matchesLast7Days: 7000,
          cadence: "hourly_digest",
          batches: true,
        }),
      ).toBe("About 1 time an hour, batched every hour");
    });
  });
});
