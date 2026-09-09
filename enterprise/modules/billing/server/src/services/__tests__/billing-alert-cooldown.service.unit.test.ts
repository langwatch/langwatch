import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingAlertCooldownService } from "../billing-alert-cooldown.service.ts";

const HOUR_MS = 60 * 60 * 1000;
const START = Date.UTC(2026, 5, 15, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BillingAlertCooldownService", () => {
  describe("when the same key is claimed twice inside the cooldown", () => {
    /** @scenario "A key taken once is refused until its cooldown has run" */
    it("gives the key to the first caller and refuses the second", async () => {
      const cooldown = BillingAlertCooldownService.create({ ttlMs: HOUR_MS });

      expect(await cooldown.claim("org-1")).toBe(true);
      vi.setSystemTime(START + HOUR_MS - 1);
      expect(await cooldown.claim("org-1")).toBe(false);
      expect(await cooldown.tryGet("org-1")).toBe(true);
    });
  });

  describe("when a different organization claims during another's cooldown", () => {
    /** @scenario "A key taken once is refused until its cooldown has run" */
    it("does not hold one organization's alert against another", async () => {
      const cooldown = BillingAlertCooldownService.create({ ttlMs: HOUR_MS });

      expect(await cooldown.claim("org-1")).toBe(true);
      expect(await cooldown.claim("org-2")).toBe(true);
    });
  });

  describe("when exactly the cooldown length has elapsed", () => {
    /** @scenario "The cooldown ends the instant it expires, not a moment before" */
    it("frees the key on the boundary rather than a tick after it", async () => {
      const cooldown = BillingAlertCooldownService.create({ ttlMs: HOUR_MS });
      await cooldown.claim("org-1");

      vi.setSystemTime(START + HOUR_MS);

      expect(await cooldown.tryGet("org-1")).toBeNull();
      expect(await cooldown.claim("org-1")).toBe(true);
    });
  });

  describe("when a month-long cooldown crosses a month end", () => {
    /** @scenario "The cooldown ends the instant it expires, not a moment before" */
    it("counts elapsed time rather than calendar months", async () => {
      const thirtyDaysMs = 30 * 24 * HOUR_MS;
      const cooldown = BillingAlertCooldownService.create({ ttlMs: thirtyDaysMs });
      vi.setSystemTime(Date.UTC(2026, 0, 20, 12, 0, 0));
      await cooldown.claim("org-1");

      vi.setSystemTime(Date.UTC(2026, 1, 18, 12, 0, 0));
      expect(await cooldown.claim("org-1")).toBe(false);

      vi.setSystemTime(Date.UTC(2026, 1, 19, 12, 0, 0));
      expect(await cooldown.claim("org-1")).toBe(true);
    });
  });

  describe("when the cooldown is cleared", () => {
    /** @scenario "Clearing a cooldown lets the next alert through immediately" */
    it("lets the next alert through without waiting", async () => {
      const cooldown = BillingAlertCooldownService.create({ ttlMs: HOUR_MS });
      await cooldown.claim("org-1");

      await cooldown.delete("org-1");

      expect(await cooldown.tryGet("org-1")).toBeNull();
      expect(await cooldown.claim("org-1")).toBe(true);
    });
  });
});
