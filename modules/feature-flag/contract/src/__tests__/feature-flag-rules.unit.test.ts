import { describe, expect, it } from "vitest";

import {
  deriveRuleOutcome,
  type FeatureFlagRules,
  featureFlagRulesSchema,
  featureFlagRulesWriteSchema,
  parseRules,
  resolveEffectiveForListing,
} from "../feature-flag-rules.ts";

const FLAG = "release_ui_agent_testing_v2_enabled";

describe("deriveRuleOutcome", () => {
  describe("when no rule matches", () => {
    it("returns null so callers can fall back to the row default", () => {
      const rules: FeatureFlagRules = [{ match: { organizationId: "org_other" }, enabled: true }];
      expect(deriveRuleOutcome(rules, { organizationId: "org_self" }, FLAG)).toBeNull();
    });
  });

  describe("when an organization-scoped rule matches the context", () => {
    it("returns the rule's enabled value without consulting later rules", () => {
      const rules: FeatureFlagRules = [
        { match: { organizationId: "org_a" }, enabled: true },
        { match: { organizationId: "org_a" }, enabled: false },
      ];
      expect(deriveRuleOutcome(rules, { organizationId: "org_a" }, FLAG)).toBe(true);
    });
  });

  describe("when a project-scoped rule overrides a broader earlier rule", () => {
    /** @scenario "The first matching rule wins" */
    it("returns the first matching rule's value (order wins)", () => {
      const rules: FeatureFlagRules = [
        { match: { projectId: "proj_x" }, enabled: false },
        { match: { organizationId: "org_a" }, enabled: true },
      ];
      const enabled = deriveRuleOutcome(
        rules,
        {
          projectId: "proj_x",
          organizationId: "org_a",
        },
        FLAG,
      );
      expect(enabled).toBe(false);
    });
  });

  describe("when a rule has an empty match", () => {
    it("matches every context so it acts as a default-rule", () => {
      const rules: FeatureFlagRules = [
        { match: { projectId: "proj_other" }, enabled: false },
        { match: {}, enabled: true },
      ];
      expect(deriveRuleOutcome(rules, { projectId: "proj_self" }, FLAG)).toBe(true);
    });
  });

  describe("when both projectId and organizationId are required", () => {
    it("only matches when every specified field equals the context", () => {
      const rules: FeatureFlagRules = [
        {
          match: { projectId: "proj_a", organizationId: "org_a" },
          enabled: true,
        },
      ];
      expect(
        deriveRuleOutcome(rules, { projectId: "proj_a", organizationId: "org_b" }, FLAG),
      ).toBeNull();
      expect(deriveRuleOutcome(rules, { projectId: "proj_a", organizationId: "org_a" }, FLAG)).toBe(
        true,
      );
    });
  });

  describe("when a rule carries an unknown match key (forward-compat)", () => {
    /** @scenario "A rule condition the reader does not understand matches nobody" */
    it("fails closed so a newer writer's condition doesn't silently match everyone", () => {
      // A future writer ships { match: { country: "NL" }, enabled: true }.
      // An older reader doesn't know about country — without
      // the fail-closed guard this would degenerate to an empty match
      // and turn into a global on-switch.
      const rules = featureFlagRulesSchema.parse([{ match: { country: "NL" }, enabled: true }]);
      expect(
        deriveRuleOutcome(
          rules,
          {
            projectId: "proj_a",
            organizationId: "org_a",
          },
          FLAG,
        ),
      ).toBeNull();
    });
  });
});

describe("a percentage rule", () => {
  describe("when an operator writes a percentage outside 0 to 100", () => {
    /** @scenario "a percentage outside 0 to 100 cannot be written" */
    it("is rejected with a message naming the valid range, and both ends are accepted", () => {
      const rule = (percentage: number): FeatureFlagRules => [
        { match: { percentageRollout: percentage }, enabled: true },
      ];
      const result = featureFlagRulesWriteSchema.safeParse(rule(150));

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("between 0 and 100");
      expect(featureFlagRulesWriteSchema.validate(rule(-1))).toBe(false);
      expect(featureFlagRulesWriteSchema.validate(rule(0))).toBe(true);
      expect(featureFlagRulesWriteSchema.validate(rule(100))).toBe(true);
    });
  });

  describe("when it is combined with an organization and another organization's user is read", () => {
    it("does not match, because every condition of a match must hold", () => {
      const rules: FeatureFlagRules = [
        { match: { organizationId: "org_acme", percentageRollout: 100 }, enabled: true },
      ];

      expect(
        deriveRuleOutcome(rules, { organizationId: "org_other", bucketingId: "user_1" }, FLAG),
      ).toBeNull();
      expect(
        deriveRuleOutcome(rules, { organizationId: "org_acme", bucketingId: "user_1" }, FLAG),
      ).toBe(true);
    });
  });

  describe("when the flag is read without a flag key to salt the bucket", () => {
    it("matches nothing rather than bucketing every flag the same way", () => {
      const rules: FeatureFlagRules = [{ match: { percentageRollout: 100 }, enabled: true }];

      expect(deriveRuleOutcome(rules, { bucketingId: "user_1" })).toBeNull();
    });
  });

  const GUIDED = "experiment_onboarding_langy_guided";
  const rollout = (percentage: number): FeatureFlagRules => [
    { match: { percentageRollout: percentage }, enabled: true },
  ];
  const readFor = (rules: FeatureFlagRules, bucketingId: string | undefined, flagKey = GUIDED) =>
    deriveRuleOutcome(rules, { organizationId: "organization_1", bucketingId }, flagKey);

  describe("when a fifty percent rule is read for the same user many times", () => {
    /** @scenario "a percentage rollout rule assigns a user the same variant on every read" */
    it("resolves to the same value on every read", () => {
      const first = readFor(rollout(50), "user_sticky");
      for (let i = 0; i < 100; i++) {
        expect(readFor(rollout(50), "user_sticky")).toBe(first);
      }
    });
  });

  describe("when a fifty percent rule is read for ten thousand distinct users", () => {
    /** @scenario "a percentage rollout rule splits users roughly evenly" */
    it("enables close to half of them", () => {
      let enabled = 0;
      for (let i = 0; i < 10_000; i++) {
        if (readFor(rollout(50), `user_${i}`) === true) enabled += 1;
      }
      expect(enabled / 10_000).toBeGreaterThan(0.47);
      expect(enabled / 10_000).toBeLessThan(0.53);
    });
  });

  describe("when the rule is read with no user to bucket", () => {
    /** @scenario "a percentage rollout rule never matches a read without a user" */
    it("matches nothing, so the read falls through to the row-level default", () => {
      expect(readFor(rollout(50), undefined)).toBeNull();
      expect(readFor(rollout(50), "")).toBeNull();
      expect(readFor(rollout(100), undefined)).toBeNull();
    });
  });

  describe("when the rollout is zero percent", () => {
    /** @scenario "a zero percent rollout matches no user" */
    it("matches no user", () => {
      for (let i = 0; i < 1_000; i++) {
        expect(readFor(rollout(0), `user_${i}`)).toBeNull();
      }
    });
  });

  describe("when the rollout is a hundred percent", () => {
    /** @scenario "a hundred percent rollout matches every user" */
    it("matches every user", () => {
      for (let i = 0; i < 1_000; i++) {
        expect(readFor(rollout(100), `user_${i}`)).toBe(true);
      }
    });
  });

  describe("when two flags with fifty percent rules are read for many users", () => {
    /** @scenario "the same user lands in different buckets for different flags" */
    it("does not put every user in the same half of both experiments", () => {
      let differing = 0;
      for (let i = 0; i < 1_000; i++) {
        const a = readFor(rollout(50), `user_${i}`, "experiment_a");
        const b = readFor(rollout(50), `user_${i}`, "experiment_b");
        if (a !== b) differing += 1;
      }
      expect(differing).toBeGreaterThan(300);
    });
  });
});

describe("parseRules", () => {
  describe("when given null or undefined", () => {
    it("returns an empty list rather than throwing", () => {
      expect(parseRules(null)).toEqual([]);
      expect(parseRules(undefined)).toEqual([]);
    });
  });

  describe("when given a malformed payload", () => {
    /** @scenario "A malformed stored rules payload is ignored" */
    it("returns an empty list so a bad row never 500s a flag check", () => {
      expect(parseRules({ not: "an array" })).toEqual([]);
      expect(parseRules([{ match: "wrong" }])).toEqual([]);
    });
  });

  describe("when the payload carries unknown match fields", () => {
    it("preserves them via passthrough so a newer writer's rule still parses", () => {
      const parsed = parseRules([
        {
          match: { organizationId: "org_a", futureField: "x" },
          enabled: true,
        },
      ]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.enabled).toBe(true);
      expect(parsed[0]?.match.organizationId).toBe("org_a");
    });
  });
});

describe("resolveEffectiveForListing", () => {
  describe("when an env override is set", () => {
    it("wins over rules, row default, and registry default", () => {
      expect(
        resolveEffectiveForListing({
          envOverride: false,
          rules: [{ match: {}, enabled: true }],
          rowEnabled: true,
          registryDefault: true,
        }),
      ).toBe(false);
    });
  });

  describe("when an empty-match rule disables the flag", () => {
    it("returns false even when the row toggle is on (regression: ops UI must not contradict the resolver)", () => {
      // Resolver semantics: an empty-match rule matches every context
      // and wins via first-match. Before this helper existed, the Ops
      // table read `row.enabled` directly and showed "on" while the
      // resolver returned false for every caller.
      expect(
        resolveEffectiveForListing({
          envOverride: null,
          rules: [{ match: {}, enabled: false }],
          rowEnabled: true,
          registryDefault: true,
        }),
      ).toBe(false);
    });
  });

  describe("when only per-target rules are present", () => {
    it("falls through to the row toggle because the listing has no context", () => {
      // Per-org/per-project rules don't match the empty default context
      // so the listing falls through to the row-level toggle, then to
      // the registry default. The targeting UI surfaces those rules
      // separately.
      expect(
        resolveEffectiveForListing({
          envOverride: null,
          rules: [{ match: { organizationId: "org_a" }, enabled: true }],
          rowEnabled: false,
          registryDefault: true,
        }),
      ).toBe(false);
    });
  });

  describe("when nothing else applies", () => {
    it("returns the registry default", () => {
      expect(
        resolveEffectiveForListing({
          envOverride: null,
          rules: [],
          rowEnabled: null,
          registryDefault: true,
        }),
      ).toBe(true);
    });
  });
});
