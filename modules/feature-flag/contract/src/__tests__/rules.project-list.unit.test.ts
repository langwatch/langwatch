/**
 * @vitest-environment node
 *
 * A project rule naming several projects, so a per-project allowlist is one rule.
 * @see specs/ops/internal-feature-flags.feature
 */
import { describe, expect, it } from "vitest";

import { deriveRuleOutcome, featureFlagRulesWriteSchema } from "../feature-flag-rules.ts";

describe("given a rule enabling the flag for two projects", () => {
  const rules = [{ match: { projectId: ["project_a", "project_b"] }, enabled: true }];

  /** @scenario "a project rule naming several projects matches each of them" */
  it("matches either project and no third one", () => {
    expect(deriveRuleOutcome(rules, { projectId: "project_a" })).toBe(true);
    expect(deriveRuleOutcome(rules, { projectId: "project_b" })).toBe(true);
    expect(deriveRuleOutcome(rules, { projectId: "project_c" })).toBeNull();
    expect(deriveRuleOutcome(rules, {})).toBeNull();
  });

  it("is accepted as an operator write", () => {
    expect(featureFlagRulesWriteSchema.validate(rules)).toBe(true);
  });
});

describe("given an operator writes a project rule", () => {
  /** @scenario "an operator cannot save a project rule that names no project" */
  it("rejects an empty list, a blank id and a padded id", () => {
    for (const projectId of [[], ["project_a", ""], [" project_a"]]) {
      expect(featureFlagRulesWriteSchema.validate([{ match: { projectId }, enabled: true }])).toBe(
        false,
      );
    }
  });
});

describe("given an operator writes the rules of one flag", () => {
  const rule = { match: { projectId: "project_a" }, enabled: true };

  /** @scenario "a rules write still holds at most 50 rules" */
  it("accepts 50 rules and rejects 51", () => {
    expect(featureFlagRulesWriteSchema.validate(Array(50).fill(rule))).toBe(true);
    expect(featureFlagRulesWriteSchema.validate(Array(51).fill(rule))).toBe(false);
  });
});
