import { describe, expect, it } from "vitest";
import { Temporal } from "@langwatch/time";
import { expiryToInstant, isShareExpiryOption, SHARE_EXPIRY_OPTIONS } from "../share-expiry.ts";

const NOW = Temporal.Instant.from("2026-08-27T12:00:00.000Z");

describe("share expiry options", () => {
  describe("when the sharer picks no expiry", () => {
    it("mints a link the contract records as never expiring", () => {
      expect(expiryToInstant({ option: "never", now: NOW })).toBeNull();
    });
  });

  describe("when the sharer picks a window", () => {
    it("offsets from the given moment", () => {
      expect(
        expiryToInstant({ option: "1h", now: NOW })?.toString({ fractionalSecondDigits: 3 }),
      ).toBe("2026-08-27T13:00:00.000Z");
      expect(
        expiryToInstant({ option: "24h", now: NOW })?.toString({ fractionalSecondDigits: 3 }),
      ).toBe("2026-08-28T12:00:00.000Z");
      expect(
        expiryToInstant({ option: "7d", now: NOW })?.toString({ fractionalSecondDigits: 3 }),
      ).toBe("2026-09-03T12:00:00.000Z");
      expect(
        expiryToInstant({ option: "30d", now: NOW })?.toString({ fractionalSecondDigits: 3 }),
      ).toBe("2026-09-26T12:00:00.000Z");
    });

    it("never returns a moment already in the past", () => {
      for (const option of SHARE_EXPIRY_OPTIONS) {
        const expiry = expiryToInstant({ option, now: NOW });
        if (expiry) {
          expect(expiry.epochMilliseconds).toBeGreaterThan(NOW.epochMilliseconds);
        }
      }
    });
  });

  describe("when a select hands back a value from outside the collection", () => {
    it("refuses it rather than widening the option type", () => {
      expect(isShareExpiryOption("never")).toBe(true);
      expect(isShareExpiryOption("90d")).toBe(false);
      expect(isShareExpiryOption(void 0)).toBe(false);
      expect(isShareExpiryOption(null)).toBe(false);
    });
  });
});
