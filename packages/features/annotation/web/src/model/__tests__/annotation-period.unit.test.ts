/**
 * The date range these lists read.
 *
 * The rule worth pinning is `isDefault`: a queue is work still to do and the
 * sidebar badge counts all of it, so the list narrows its read only once a
 * range has actually been picked. Reading the fallback window as a pick would
 * leave the badge and the list disagreeing about how much work is waiting.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { describe, expect, it } from "vitest";
import {
  absolutePeriodAddress,
  clearedPeriodAddress,
  computeRelativeWindow,
  matchingPreset,
  readAnnotationPeriod,
  relativePeriodAddress,
} from "../annotation-period";

const NOW = new Date("2026-08-08T12:00:00Z");

describe("given an address with no range on it", () => {
  describe("when a list reads its window", () => {
    it("falls back to thirty days and says the range was not picked", () => {
      const reading = readAnnotationPeriod({ query: {}, now: NOW });

      expect(reading.mode).toBe("relative");
      expect(reading.isDefault).toBe(true);
      expect(reading.period.endDate).toEqual(NOW);
    });
  });
});

describe("given an address naming a preset", () => {
  describe("when a list reads its window", () => {
    it("resolves the preset and says the range was picked", () => {
      const reading = readAnnotationPeriod({ query: { period: "7d" }, now: NOW });

      expect(reading.isDefault).toBe(false);
      expect(reading.period).toEqual(computeRelativeWindow("7d", NOW));
    });
  });

  describe("when the preset is one nothing offers", () => {
    it("falls back and says the range was not picked", () => {
      const reading = readAnnotationPeriod({ query: { period: "42d" }, now: NOW });

      expect(reading.isDefault).toBe(true);
    });
  });
});

describe("given an address naming two timestamps", () => {
  describe("when a list reads its window", () => {
    it("reads them as an absolute range", () => {
      const reading = readAnnotationPeriod({
        query: {
          startDate: "2026-07-01T00:00:00.000Z",
          endDate: "2026-08-01T00:00:00.000Z",
        },
        now: NOW,
      });

      expect(reading.mode).toBe("absolute");
      expect(reading.isDefault).toBe(false);
      expect(reading.period.startDate).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    });
  });

  describe("when the start is after the end", () => {
    it("clamps the start rather than reading an empty window", () => {
      const reading = readAnnotationPeriod({
        query: {
          startDate: "2026-09-01T00:00:00.000Z",
          endDate: "2026-08-01T00:00:00.000Z",
        },
        now: NOW,
      });

      expect(reading.period.startDate).toEqual(reading.period.endDate);
    });
  });

  describe("when one of them is not a date", () => {
    it("ignores both and falls back to the preset reading", () => {
      const reading = readAnnotationPeriod({
        query: { startDate: "sometime", endDate: "2026-08-01T00:00:00.000Z" },
        now: NOW,
      });

      expect(reading.mode).toBe("relative");
      expect(reading.isDefault).toBe(true);
    });
  });
});

describe("given a sub-day preset", () => {
  describe("when the window is resolved", () => {
    it("counts back from now rather than snapping to a day", () => {
      const window = computeRelativeWindow("15m", NOW);

      expect(window.endDate).toEqual(NOW);
      expect(NOW.getTime() - window.startDate.getTime()).toBe(15 * 60_000);
    });
  });
});

describe("given the reviewer changes the range", () => {
  describe("when they pick two timestamps", () => {
    it("writes them and drops whatever preset was on the address", () => {
      const address = absolutePeriodAddress({
        current: { period: "7d", pageOffset: "25" },
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
      });

      expect(address.period).toBeUndefined();
      expect(address.startDate).toBe("2026-07-01T00:00:00.000Z");
      expect(address.pageOffset).toBe("25");
    });
  });

  describe("when they pick a preset", () => {
    it("writes it and drops whatever timestamps were on the address", () => {
      const address = relativePeriodAddress({
        current: { startDate: "a", endDate: "b" },
        presetKey: "90d",
      });

      expect(address.period).toBe("90d");
      expect(address.startDate).toBeUndefined();
      expect(address.endDate).toBeUndefined();
    });
  });

  describe("when they choose All time", () => {
    it("takes all three keys off and keeps the rest", () => {
      const address = clearedPeriodAddress({
        period: "30d",
        startDate: "a",
        endDate: "b",
        pageOffset: "25",
      });

      expect(address.period).toBeUndefined();
      expect(address.startDate).toBeUndefined();
      expect(address.endDate).toBeUndefined();
      expect(address.pageOffset).toBe("25");
    });
  });
});

describe("given a window on screen", () => {
  describe("when the trigger asks what to call it", () => {
    it("names the preset it matches exactly", () => {
      expect(matchingPreset({ period: computeRelativeWindow("7d", NOW), now: NOW })?.key).toBe(
        "7d",
      );
      expect(matchingPreset({ period: computeRelativeWindow("30d", NOW), now: NOW })?.key).toBe(
        "30d",
      );
    });

    /**
     * INHERITED, and said out loud rather than asserted away: the day-span
     * match is tried first, every sub-day preset also spans one calendar day,
     * and `today` is the one-day preset — so a fifteen-minute window reads
     * "Today". That is what `platform/app` has always shown, and which of two
     * presets wins is a behaviour change a page move does not own.
     */
    it("labels a sub-day window Today, the way the platform control did", () => {
      expect(matchingPreset({ period: computeRelativeWindow("15m", NOW), now: NOW })?.key).toBe(
        "today",
      );
    });

    it("names nothing for a window no preset produces", () => {
      expect(
        matchingPreset({
          period: {
            startDate: new Date("2026-07-03T00:00:00Z"),
            endDate: new Date("2026-07-14T00:00:00Z"),
          },
          now: NOW,
        }),
      ).toBeUndefined();
    });
  });
});
