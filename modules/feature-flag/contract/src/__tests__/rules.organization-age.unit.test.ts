import { Temporal } from "@langwatch/time";
/**
 * @vitest-environment node
 *
 * An age condition the matcher cannot evaluate must fail closed: degrading to
 * "no condition" would match everyone, the opposite of targeting new signups.
 */
import { describe, expect, it } from "vitest";

import {
  deriveRuleOutcome,
  type FeatureFlagRules,
  featureFlagRulesWriteSchema,
  parseRules,
  readNeedsOrganizationAge,
} from "../feature-flag-rules.ts";

const ROLLOUT_START = "2026-06-01";
const NEW_USERS_RULE: FeatureFlagRules = [
  { match: { organizationCreatedAfter: ROLLOUT_START }, enabled: true },
];

describe("given a rule naming the date a rollout starts", () => {
  describe("when the flag is read for an organization created after that date", () => {
    /** @scenario "a new-users rule enables the flag for an organization created after its date" */
    it("resolves enabled from the rule", () => {
      const enabled = deriveRuleOutcome(NEW_USERS_RULE, {
        organizationId: "organization_new",
        organizationCreatedAt: Temporal.Instant.from("2026-07-15T09:00:00.000Z"),
      });

      expect(enabled).toBe(true);
    });
  });

  describe("when the flag is read for an organization that predates the rollout", () => {
    /** @scenario "an organization that predates the rollout date sees no change" */
    it("matches nothing, so the read falls through to the row-level default", () => {
      const enabled = deriveRuleOutcome(NEW_USERS_RULE, {
        organizationId: "organization_old",
        organizationCreatedAt: Temporal.Instant.from("2025-01-05T09:00:00.000Z"),
      });

      expect(enabled).toBeNull();
    });
  });

  describe("when the organization was created at the very start of that date", () => {
    /** @scenario "an organization created on the rollout date itself is included" */
    it("matches, because an operator reads the date as 'from this day on'", () => {
      const enabled = deriveRuleOutcome(NEW_USERS_RULE, {
        organizationId: "organization_boundary",
        organizationCreatedAt: Temporal.Instant.from("2026-06-01T00:00:00.000Z"),
      });

      expect(enabled).toBe(true);
    });
  });

  describe("when the read carries no organization creation date", () => {
    /** @scenario "a read with no organization creation date matches no age rule" */
    it("does not match, rather than reaching every caller whose age is unknown", () => {
      expect(deriveRuleOutcome(NEW_USERS_RULE, { organizationId: "organization_new" })).toBeNull();
      expect(deriveRuleOutcome(NEW_USERS_RULE, { organizationCreatedAt: null })).toBeNull();
    });
  });

  describe("when an organization creation date arrives as an ISO string", () => {
    it("compares it the same way it compares a Date, since JSON carries strings", () => {
      expect(
        deriveRuleOutcome(NEW_USERS_RULE, {
          organizationId: "organization_new",
          organizationCreatedAt: "2026-08-20T12:00:00.000Z",
        }),
      ).toBe(true);
    });
  });
});

describe("given a stored rule whose date is not a date", () => {
  /** @scenario "a stored rule whose date cannot be read never matches" */
  it("matches nobody, instead of degrading into a rule with no conditions", () => {
    const rules = parseRules([{ match: { organizationCreatedAfter: "whenever" }, enabled: true }]);

    expect(rules).toHaveLength(1);
    expect(
      deriveRuleOutcome(rules, {
        organizationId: "organization_new",
        organizationCreatedAt: Temporal.Instant.from("2030-01-01T00:00:00.000Z"),
      }),
    ).toBeNull();
  });
});

describe("given an age rule alongside rules for named targets", () => {
  it("still resolves first-match-wins, so an earlier opt-out shadows it", () => {
    const rules: FeatureFlagRules = [
      { match: { organizationId: "organization_new" }, enabled: false },
      { match: { organizationCreatedAfter: ROLLOUT_START }, enabled: true },
    ];

    const enabled = deriveRuleOutcome(rules, {
      organizationId: "organization_new",
      organizationCreatedAt: Temporal.Instant.from("2026-07-15T09:00:00.000Z"),
    });

    expect(enabled).toBe(false);
  });
});

describe("readNeedsOrganizationAge", () => {
  const ctx = {
    organizationId: "organization_a",
    projectId: "project_a",
  } as const;

  describe("when no rule names a date", () => {
    /** @scenario "the creation date is fetched only for a flag that has an age rule" */
    it("reports false, which is what keeps the hot path free of a lookup", () => {
      expect(
        readNeedsOrganizationAge({
          rules: [
            { match: { projectId: "project_b" }, enabled: true },
            { match: { organizationId: "organization_b" }, enabled: false },
            { match: {}, enabled: false },
          ],
          ctx,
        }),
      ).toBe(false);
    });
  });

  describe("when a date rule sits behind rules about other tenants", () => {
    it("reports true, because none of those decides this read", () => {
      expect(
        readNeedsOrganizationAge({
          rules: [{ match: { projectId: "project_b" }, enabled: true }, ...NEW_USERS_RULE],
          ctx,
        }),
      ).toBe(true);
    });
  });

  describe("when a rule about this very context sits above the date rule", () => {
    /** @scenario "no creation date is fetched once an earlier rule already decides the read" */
    it("reports false, because that rule answers before the date is needed", () => {
      expect(
        readNeedsOrganizationAge({
          rules: [
            { match: { organizationId: "organization_a" }, enabled: true },
            ...NEW_USERS_RULE,
          ],
          ctx,
        }),
      ).toBe(false);
    });
  });

  describe("when the rule above the date rule names this organization and a date", () => {
    it("reports true, since its own date is what decides whether it matches", () => {
      expect(
        readNeedsOrganizationAge({
          rules: [
            {
              match: {
                organizationId: "organization_a",
                organizationCreatedAfter: "2026-06-01",
              },
              enabled: true,
            },
          ],
          ctx,
        }),
      ).toBe(true);
    });
  });
});

describe("what an operator is allowed to save", () => {
  describe("when a new-users rule carries no date", () => {
    /** @scenario "an operator cannot save an age rule without a readable date" */
    it("is rejected, because the rule could never match", () => {
      const result = featureFlagRulesWriteSchema.safeParse([
        { match: { organizationCreatedAfter: "" }, enabled: true },
      ]);

      expect(result.success).toBe(false);
    });
  });

  describe("when a new-users rule carries something that is not a date", () => {
    /** @scenario "an operator cannot save an age rule without a readable date" */
    it("is rejected", () => {
      expect(
        featureFlagRulesWriteSchema.validate([
          {
            match: { organizationCreatedAfter: "next quarter" },
            enabled: true,
          },
        ]),
      ).toBe(false);
    });
  });

  describe("when a new-users rule carries a calendar date", () => {
    it("is accepted", () => {
      expect(featureFlagRulesWriteSchema.validate(NEW_USERS_RULE)).toBe(true);
    });
  });

  describe("when an organization rule carries a padded id", () => {
    it("is still rejected, as it was before age rules existed", () => {
      expect(
        featureFlagRulesWriteSchema.validate([
          { match: { organizationId: " organization_a " }, enabled: true },
        ]),
      ).toBe(false);
    });
  });
});
