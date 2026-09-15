/**
 * The note under a flag's toggle, which is the only place the page says the
 * flag is live somewhere while the toggle itself reads off.
 *
 * @see specs/ops/internal-feature-flags.feature
 */
import { featureFlagRulesSchema } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";

import { summarizeTargeting, targetingLabel } from "../targeting-summary.ts";

const note = (rules: unknown) =>
  targetingLabel(summarizeTargeting(featureFlagRulesSchema.parse(rules)));

describe("the targeting note", () => {
  describe("given a rule turns a flag off for one organization and a later rule turns it on for everyone", () => {
    describe("when the note is written", () => {
      /** @scenario "a catch-all note admits the targets a rule above it excludes" */
      it("says the flag is on for everyone except that organization", () => {
        const label = note([
          { match: { organizationId: "organization_a" }, enabled: false },
          { match: {}, enabled: true },
        ]);

        expect(label).toBe("Enabled for everyone via rule, except 1 organization");
      });
    });
  });

  describe("given a rule turns a flag off since January and a later rule turns it on since June", () => {
    describe("when the note is written", () => {
      /** @scenario "a new-users rule an earlier rule already answered for is not claimed" */
      it("does not offer June, because the January rule answers first for everyone June reaches", () => {
        const label = note([
          { match: { organizationCreatedAfter: "2026-01-01" }, enabled: false },
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
        ]);

        expect(label).toBeNull();
      });
    });
  });

  describe("given a rule turns a flag off since June and a later rule turns it on since January", () => {
    describe("when the note is written", () => {
      /** @scenario "a new-users range a later rule closes is reported as a range" */
      it("names both ends, since January alone would claim organizations June switches back off", () => {
        const label = note([
          { match: { organizationCreatedAfter: "2026-06-01" }, enabled: false },
          { match: { organizationCreatedAfter: "2026-01-01" }, enabled: true },
        ]);

        expect(label).toContain("on or after");
        expect(label).toContain("before");
        expect(label).toMatch(/Jan/);
        expect(label).toMatch(/Jun/);
      });
    });
  });

  describe("given no rule enables the flag for anyone", () => {
    it("writes no note at all", () => {
      expect(note([{ match: { organizationId: "organization_a" }, enabled: false }])).toBeNull();
    });
  });

  describe("given a rule below a catch-all", () => {
    it("is not counted, because it can never fire", () => {
      const summary = summarizeTargeting(
        featureFlagRulesSchema.parse([
          { match: {}, enabled: true },
          { match: { organizationId: "organization_b" }, enabled: false },
        ]),
      );

      expect(summary.enabledForEveryone).toBe(true);
      expect(summary.excludedOrganizationCount).toBe(0);
    });
  });
});
