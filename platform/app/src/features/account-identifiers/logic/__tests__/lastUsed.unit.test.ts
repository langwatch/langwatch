import { describe, expect, it } from "vitest";
import { lastUsedLabel } from "../lastUsed";

const NOW = new Date("2026-08-25T12:00:00.000Z");

const daysBefore = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("given a sign-in method's last use", () => {
  describe("when it was used recently", () => {
    it("says so in relative terms, which is what settles the question", () => {
      expect(lastUsedLabel(daysBefore(0), NOW)).toBe("Last used today");
      expect(lastUsedLabel(daysBefore(1), NOW)).toBe("Last used yesterday");
      expect(lastUsedLabel(daysBefore(9), NOW)).toBe("Last used 9 days ago");
    });
  });

  describe("when it was used long ago", () => {
    it("gives a date, because a count of days stops being picturable", () => {
      expect(lastUsedLabel(daysBefore(400), NOW)).toMatch(/Last used .*2025/);
    });
  });

  describe("when we hold no session naming it", () => {
    /**
     * THE one that matters. Sessions expire and are deleted, so an absent
     * answer means "not in any session we still hold" and not "never used".
     * Saying "never used" about a credential whose evidence merely aged out
     * is how somebody gets talked into deleting the passkey they sign in
     * with, so the row says nothing at all.
     */
    it("answers null rather than claiming it was never used", () => {
      expect(lastUsedLabel(null, NOW)).toBeNull();
      expect(lastUsedLabel(void 0, NOW)).toBeNull();
      expect(lastUsedLabel("not-a-timestamp", NOW)).toBeNull();
    });
  });

  describe("when a clock is skewed into the future", () => {
    it("reads as today rather than as a negative count", () => {
      const ahead = new Date(NOW.getTime() + 60_000).toISOString();
      expect(lastUsedLabel(ahead, NOW)).toBe("Last used today");
    });
  });
});
