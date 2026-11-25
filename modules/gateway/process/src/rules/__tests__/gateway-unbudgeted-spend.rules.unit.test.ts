/**
 * Which keys spent without a budget this week, and the fact gateway records of them.
 * @see modules/gateway/specs/gateway-governance-events.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  keysAtOrOverThreshold,
  UNBUDGETED_SPEND_PERIOD_OF,
  UNBUDGETED_SPEND_THRESHOLD_NANO_USD,
  type UnbudgetedSpendKey,
  unbudgetedSpendFactOf,
  unbudgetedSpendWindowAt,
} from "../gateway-unbudgeted-spend.rules.ts";

const NOW = Temporal.Instant.from("2026-11-25T10:00:00Z");
const USD = 1_000_000_000;

const key = (id: string): UnbudgetedSpendKey => ({
  id,
  organizationId: "org-1",
  name: `${id} name`,
  principalUserId: null,
  traceProjectId: null,
});

describe("unbudgeted spend rules", () => {
  describe("when a key's week of spend sits on the threshold", () => {
    /** @scenario "A key at or over the threshold with no budget is named, one under it is not" */
    it("keeps the key at exactly $5 and drops the one a nano-dollar under", () => {
      const candidates = keysAtOrOverThreshold({
        totals: [
          { virtualKeyId: "at", amountNanoUsd: UNBUDGETED_SPEND_THRESHOLD_NANO_USD },
          { virtualKeyId: "under", amountNanoUsd: UNBUDGETED_SPEND_THRESHOLD_NANO_USD - 1 },
        ],
        keys: [key("at"), key("under")],
      });

      expect(UNBUDGETED_SPEND_THRESHOLD_NANO_USD).toBe(5 * USD);
      expect(candidates.map(({ key: { id } }) => id)).toEqual(["at"]);
    });
  });

  describe("when the ledger totals a key the sweep did not list", () => {
    /** @scenario "A key at or over the threshold with no budget is named, one under it is not" */
    it("drops it: a key of another purpose, revoked or disabled, is not the organization's to hear of", () => {
      const candidates = keysAtOrOverThreshold({
        totals: [{ virtualKeyId: "langy", amountNanoUsd: 50 * USD }],
        keys: [key("listed")],
      });

      expect(candidates).toEqual([]);
    });
  });

  describe("when seven keys spent without a budget", () => {
    /** @scenario "The fact names the five keys that spent most, and counts and totals all of them" */
    it("names the five that spent most, most first and ties by id, and counts and totals all seven", () => {
      const spend = (id: string, usd: number) => ({ key: key(id), amountNanoUsd: usd * USD });

      const fact = unbudgetedSpendFactOf({
        organizationId: "org-1",
        unbudgeted: [
          spend("a", 6),
          spend("b", 30),
          spend("c", 9),
          spend("d", 9),
          spend("e", 12),
          spend("f", 5),
          spend("g", 7),
        ],
        now: NOW,
      });

      expect(fact).toEqual({
        organization_id: "org-1",
        iso_week: "2026-W48",
        keys: [
          { virtual_key_id: "b", name: "b name", spent_usd: "30" },
          { virtual_key_id: "e", name: "e name", spent_usd: "12" },
          { virtual_key_id: "c", name: "c name", spent_usd: "9" },
          { virtual_key_id: "d", name: "d name", spent_usd: "9" },
          { virtual_key_id: "g", name: "g name", spent_usd: "7" },
        ],
        key_count: 7,
        total_spent_usd: "78",
        occurred_at: NOW.epochMilliseconds,
      });
    });
  });

  describe("when the sweep runs", () => {
    it("reads the last seven UTC days, today included, and keys the week ISO-style", () => {
      expect(unbudgetedSpendWindowAt(NOW)).toEqual({
        fromDay: "2026-11-19",
        toDay: "2026-11-25",
        since: Temporal.Instant.from("2026-11-19T00:00:00Z"),
      });
      expect(UNBUDGETED_SPEND_PERIOD_OF(Temporal.Instant.from("2027-01-01T12:00:00Z"))).toBe(
        "2026-W53",
      );
      expect(UNBUDGETED_SPEND_PERIOD_OF(Temporal.Instant.from("2026-02-02T00:00:00Z"))).toBe(
        "2026-W06",
      );
    });
  });
});
