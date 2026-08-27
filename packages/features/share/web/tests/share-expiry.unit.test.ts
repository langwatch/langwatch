import { describe, expect, it } from "vitest";
import { expiryToDate, isShareExpiryOption, SHARE_EXPIRY_OPTIONS } from "../src/share-expiry";

const NOW = new Date("2026-08-27T12:00:00.000Z");

describe("share expiry options", () => {
  describe("when the sharer picks no expiry", () => {
    it("mints a link the contract records as never expiring", () => {
      expect(expiryToDate({ option: "never", now: NOW })).toBeNull();
    });
  });

  describe("when the sharer picks a window", () => {
    it("offsets from the given moment", () => {
      expect(expiryToDate({ option: "1h", now: NOW })?.toISOString()).toBe(
        "2026-08-27T13:00:00.000Z",
      );
      expect(expiryToDate({ option: "24h", now: NOW })?.toISOString()).toBe(
        "2026-08-28T12:00:00.000Z",
      );
      expect(expiryToDate({ option: "7d", now: NOW })?.toISOString()).toBe(
        "2026-09-03T12:00:00.000Z",
      );
      expect(expiryToDate({ option: "30d", now: NOW })?.toISOString()).toBe(
        "2026-09-26T12:00:00.000Z",
      );
    });

    it("never returns a moment already in the past", () => {
      for (const option of SHARE_EXPIRY_OPTIONS) {
        const expiry = expiryToDate({ option, now: NOW });
        if (expiry) {
          expect(expiry.getTime()).toBeGreaterThan(NOW.getTime());
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
