import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatLeaseLapse,
  formatTtl,
  sweepOutcomeLabel,
} from "../blobFormatters";

const NOW = new Date("2026-07-22T12:00:00.000Z");

describe("formatTtl", () => {
  describe("given a key with no expiry", () => {
    it("says so rather than showing a duration", () => {
      expect(formatTtl(null)).toBe("No expiry");
    });
  });

  describe("given a remaining lifetime", () => {
    it("keeps sub-minute values in seconds", () => {
      expect(formatTtl(59)).toBe("59s");
    });

    it("rounds to the nearest minute under an hour", () => {
      expect(formatTtl(90)).toBe("2m");
    });

    it("switches to hours at an hour", () => {
      expect(formatTtl(3600)).toBe("1h");
    });

    it("switches to days at a day", () => {
      expect(formatTtl(86_400)).toBe("1d");
    });
  });
});

describe("formatLeaseLapse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given no lease member remains", () => {
    it("reports none rather than an age", () => {
      expect(formatLeaseLapse(null)).toBe("None");
    });
  });

  describe("given a deadline that has not passed", () => {
    it("reads as live, because something still holds the blob", () => {
      expect(formatLeaseLapse(NOW.getTime() + 60_000)).toBe("Live");
    });

    it("treats a deadline landing exactly now as still live", () => {
      expect(formatLeaseLapse(NOW.getTime())).toBe("Live");
    });
  });

  describe("given a lapsed deadline", () => {
    it("dates how long ago the holder stopped renewing", () => {
      expect(formatLeaseLapse(NOW.getTime() - 5 * 60_000)).toBe("5m ago");
    });

    it("scales to days for a long-dead holder", () => {
      expect(formatLeaseLapse(NOW.getTime() - 3 * 86_400_000)).toBe("3d ago");
    });
  });
});

describe("sweepOutcomeLabel", () => {
  describe("given an outcome this build does not know", () => {
    it("falls back to a rendered label instead of undefined", () => {
      const fallback = sweepOutcomeLabel("a_verdict_added_server_side");
      expect(fallback.label).toBeTruthy();
      expect(fallback.palette).toBeTruthy();
    });

    it("does not reuse a live-lease colour for the unknown case", () => {
      expect(sweepOutcomeLabel("brand_new_verdict")).not.toEqual(
        sweepOutcomeLabel("leased"),
      );
    });
  });
});
