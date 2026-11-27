/**
 * The user scope in the targeting rules dialog: a stored rule naming users opens
 * as a User rule and saves the same ids back.
 * @see specs/ops/internal-feature-flags.feature
 */
import { describe, expect, it } from "vitest";

import { findUnfillableRule, rulesToUI, uiToRules } from "../rule-editing.ts";
import { summarizeTargeting, targetingLabel } from "../targeting-summary.ts";

describe("given a stored rule enabling the flag for two users", () => {
  const stored = [{ match: { userId: ["user_a", "user_b"] }, enabled: true }];

  /** @scenario "the ops page reads and writes a user rule" */
  it("opens as a User rule with both users and saves the same ids back", () => {
    const ui = rulesToUI(stored);

    expect(ui[0]).toMatchObject({ scopeKind: "USER", target: "user_a, user_b" });
    expect(uiToRules(ui)).toEqual(stored);
  });

  it("refuses to save a user rule that names nobody", () => {
    const [rule] = rulesToUI(stored);
    if (!rule) throw new Error("expected one rule");

    expect(findUnfillableRule([{ ...rule, target: " , " }])).toBeDefined();
  });

  it("counts the users in the note under the toggle", () => {
    expect(targetingLabel(summarizeTargeting(stored))).toBe("Enabled for 2 users");
  });
});
