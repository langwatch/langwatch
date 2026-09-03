// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The settling window and the retention floor are set in two different
 * modules, and only one of them knows the other exists.
 *
 * A day inside its settling window is rendered to the customer as "this can
 * still move". If retention could expire that day's events while the screen is
 * still saying so, we would be promising a figure can change on a day we can
 * no longer act on — the restatement is unfoldable and an erasure of it is
 * unrebuildable. Today the floor clears the window by five days, entirely by
 * accident of two unrelated decisions. This is what notices if one of them
 * moves.
 *
 * Spec: specs/governance/governance-data-retention.feature
 * Decision: ADR-128 §15 (the settling window), ADR-022 (retention is the ceiling)
 */
import { describe, expect, it } from "vitest";

import {
  MIN_RETENTION_DAYS,
  PAID_RETENTION_PRESET_DAYS,
  retentionDaysSchema,
} from "~/server/data-retention/retentionPolicy.schema";
import { GOVERNANCE_SETTLING_WINDOW_DAYS } from "../governanceCostRollup.constants";

describe("given a cost day the screen calls provisional", () => {
  describe("when the shortest retention a customer can set is applied to it", () => {
    /** @scenario "A day the screen says can still change is a day we can still act on" */
    it("still holds the day's events for longer than the day stays provisional", () => {
      // The floor the schema enforces, and the shortest value on the paid menu,
      // are two separate ways to reach the same low number. Check both.
      const shortestSettable = Math.min(
        MIN_RETENTION_DAYS,
        ...PAID_RETENTION_PRESET_DAYS,
      );

      expect(shortestSettable).toBeGreaterThan(GOVERNANCE_SETTLING_WINDOW_DAYS);
    });

    /** @scenario "A day the screen says can still change is a day we can still act on" */
    it("rejects a retention shorter than the settling window", () => {
      // Without this the assertion above could pass against a schema that has
      // stopped enforcing anything: it names a constant, not a behaviour.
      const insideTheWindow = 28;
      expect(insideTheWindow).toBeLessThan(GOVERNANCE_SETTLING_WINDOW_DAYS);
      expect(retentionDaysSchema.safeParse(insideTheWindow).success).toBe(
        false,
      );

      // And it does accept the shortest value we claim is settable, so the
      // rejection above is about the length rather than about the schema
      // refusing everything.
      expect(
        retentionDaysSchema.safeParse(Math.min(...PAID_RETENTION_PRESET_DAYS))
          .success,
      ).toBe(true);
    });
  });
});
