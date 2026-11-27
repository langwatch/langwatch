/**
 * @vitest-environment node
 *
 * A rule naming signed-in users by id; no signed-in user, no match.
 */
import { describe, expect, it } from "vitest";

import {
  deriveRuleOutcome,
  type FeatureFlagRules,
  featureFlagRulesWriteSchema,
  userIdsOf,
} from "../feature-flag-rules.ts";
import { ruleContextForTarget } from "../feature-flag-target.ts";

const rules: FeatureFlagRules = [{ match: { userId: ["user_a", "user_b"] }, enabled: true }];

describe("given a rule enabling the flag for two users", () => {
  /** @scenario "a user rule enables the flag for a named user" */
  it("resolves enabled for a named user and matches nothing for a third", () => {
    const read = (userId: string) =>
      deriveRuleOutcome(
        rules,
        ruleContextForTarget({ kind: "organization", organizationId: "org_1", userId }),
      );
    expect(read("user_a")).toBe(true);
    expect(read("user_b")).toBe(true);
    expect(read("user_c")).toBeNull();
  });

  /** @scenario "a read with no signed-in user matches no user rule" */
  it("matches nothing for a system or anonymous read", () => {
    expect(deriveRuleOutcome(rules, ruleContextForTarget({ kind: "system" }))).toBeNull();
    expect(
      deriveRuleOutcome(rules, ruleContextForTarget({ kind: "anonymous", anonymousId: "user_a" })),
    ).toBeNull();
  });
});

describe("when an operator writes a user rule", () => {
  /** @scenario "an operator cannot save a user rule that names no user" */
  it("refuses an empty list, a blank id and a padded id", () => {
    for (const userId of [[], "", " user_a", ["user_a", ""]]) {
      expect(featureFlagRulesWriteSchema.validate([{ match: { userId }, enabled: true }])).toBe(
        false,
      );
    }
    expect(
      featureFlagRulesWriteSchema.validate([{ match: { userId: ["user_a"] }, enabled: true }]),
    ).toBe(true);
  });

  it("reads one id or a list as a list", () => {
    expect(userIdsOf("user_a")).toEqual(["user_a"]);
    expect(userIdsOf(["user_a", "user_b"])).toEqual(["user_a", "user_b"]);
    expect(userIdsOf(undefined)).toEqual([]);
  });
});
