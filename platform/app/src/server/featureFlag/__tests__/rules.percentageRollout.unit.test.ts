/**
 * @vitest-environment node
 *
 * The percentage rollout condition: a rule that names a share of users
 * instead of an id, matching every caller whose stable bucket falls below it.
 *
 * Two properties matter. It is sticky: the bucket is a hash of the flag key
 * and the caller's distinct id, so the same user reads the same answer on
 * every read and from every pod. And it fails closed: a read with no distinct
 * id, an organization-scoped or project-scoped read from a job, never
 * matches, because a rule the matcher cannot evaluate must not become a rule
 * with no condition.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { describe, expect, it } from "vitest";
import {
  evaluateRules,
  type FeatureFlagRules,
  featureFlagRulesWriteSchema,
  rolloutBucket,
} from "../rules";

const FLAG_KEY = "experiment_onboarding_langy_guided";

function rolloutRule(percentage: number): FeatureFlagRules {
  return [{ match: { percentageRollout: percentage }, enabled: true }];
}

function readFor(
  rules: FeatureFlagRules,
  distinctId: string | undefined,
  flagKey: string = FLAG_KEY,
): boolean | null {
  return evaluateRules(rules, {
    organizationId: "organization_1",
    distinctId,
    flagKey,
  });
}

describe("given a targeting rule enabling the flag for half the users", () => {
  const rules = rolloutRule(50);

  describe("when the flag is read for the same user many times", () => {
    /** @scenario "a percentage rollout rule assigns a user the same variant on every read" */
    it("resolves to the same value on every read", () => {
      const first = readFor(rules, "user_sticky");
      for (let i = 0; i < 100; i++) {
        expect(readFor(rules, "user_sticky")).toBe(first);
      }
    });
  });

  describe("when the flag is read for ten thousand distinct users", () => {
    /** @scenario "a percentage rollout rule splits users roughly evenly" */
    it("enables close to half of them", () => {
      const total = 10_000;
      let enabled = 0;
      for (let i = 0; i < total; i++) {
        if (readFor(rules, `user_${i}`) === true) enabled += 1;
      }
      const share = enabled / total;
      expect(share).toBeGreaterThan(0.47);
      expect(share).toBeLessThan(0.53);
    });
  });

  describe("when the flag is read with no distinct id", () => {
    /** @scenario "a percentage rollout rule never matches a read without a user" */
    it("matches nothing, so the read falls through to the row-level default", () => {
      expect(readFor(rules, undefined)).toBeNull();
      expect(readFor(rules, "")).toBeNull();
    });
  });

  describe("when the flag is read without a flag key to salt the bucket", () => {
    it("matches nothing rather than bucketing every flag the same way", () => {
      expect(
        evaluateRules(rules, {
          organizationId: "organization_1",
          distinctId: "user_1",
        }),
      ).toBeNull();
    });
  });
});

describe("given the two ends of the range", () => {
  describe("when the rollout is zero percent", () => {
    /** @scenario "a zero percent rollout matches no user" */
    it("matches no user", () => {
      const rules = rolloutRule(0);
      for (let i = 0; i < 1_000; i++) {
        expect(readFor(rules, `user_${i}`)).toBeNull();
      }
    });
  });

  describe("when the rollout is a hundred percent", () => {
    /** @scenario "a hundred percent rollout matches every user" */
    it("matches every user", () => {
      const rules = rolloutRule(100);
      for (let i = 0; i < 1_000; i++) {
        expect(readFor(rules, `user_${i}`)).toBe(true);
      }
    });
  });
});

describe("given two flags each with a fifty percent rollout", () => {
  describe("when both are read for many users", () => {
    /** @scenario "the same user lands in different buckets for different flags" */
    it("does not put every user in the same half of both experiments", () => {
      const rules = rolloutRule(50);
      let differing = 0;
      for (let i = 0; i < 1_000; i++) {
        const a = readFor(rules, `user_${i}`, "experiment_a");
        const b = readFor(rules, `user_${i}`, "experiment_b");
        if (a !== b) differing += 1;
      }
      expect(differing).toBeGreaterThan(300);
    });
  });
});

describe("rolloutBucket", () => {
  it("is deterministic and stays inside [0, 100)", () => {
    for (let i = 0; i < 1_000; i++) {
      const bucket = rolloutBucket({
        flagKey: FLAG_KEY,
        distinctId: `user_${i}`,
      });
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(
        rolloutBucket({ flagKey: FLAG_KEY, distinctId: `user_${i}` }),
      ).toBe(bucket);
    }
  });
});

describe("given an operator writing a percentage rule", () => {
  describe("when the percentage is outside 0 to 100", () => {
    /** @scenario "a percentage outside 0 to 100 cannot be written" */
    it("is rejected with a message naming the valid range", () => {
      const result = featureFlagRulesWriteSchema.safeParse(rolloutRule(150));
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.message).toContain("between 0 and 100");

      expect(
        featureFlagRulesWriteSchema.safeParse(rolloutRule(-1)).success,
      ).toBe(false);
    });
  });

  describe("when the percentage is inside the range", () => {
    it("is accepted at both ends", () => {
      expect(
        featureFlagRulesWriteSchema.safeParse(rolloutRule(0)).success,
      ).toBe(true);
      expect(
        featureFlagRulesWriteSchema.safeParse(rolloutRule(100)).success,
      ).toBe(true);
    });
  });
});

describe("given a percentage rule combined with an organization", () => {
  describe("when a user of another organization is read", () => {
    it("does not match, because every condition of a match must hold", () => {
      const rules: FeatureFlagRules = [
        {
          match: {
            organizationId: "organization_acme",
            percentageRollout: 100,
          },
          enabled: true,
        },
      ];
      expect(
        evaluateRules(rules, {
          organizationId: "organization_other",
          distinctId: "user_1",
          flagKey: FLAG_KEY,
        }),
      ).toBeNull();
      expect(
        evaluateRules(rules, {
          organizationId: "organization_acme",
          distinctId: "user_1",
          flagKey: FLAG_KEY,
        }),
      ).toBe(true);
    });
  });
});
