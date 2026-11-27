/**
 * Picking targets into a rule's field and naming the ids stored rules hold.
 * @see modules/ops/specs/feature-flag-target-search.feature
 */
import { describe, expect, it } from "vitest";

import { targetIdsOf, withoutId, withPickedId } from "../rule-targets.ts";

describe("when an operator picks targets into a rule", () => {
  /** @scenario "picking a search result fills the rule with its id" */
  it("swaps the single organization id", () => {
    expect(withPickedId({ target: "organization_a", id: "organization_b", multiple: false })).toBe(
      "organization_b",
    );
  });

  /** @scenario "a project rule and a user rule take several picked targets" */
  it("appends to a list without repeats, and removes one id", () => {
    const two = withPickedId({ target: "project_a", id: "project_b", multiple: true });
    expect(two).toBe("project_a, project_b");
    expect(withPickedId({ target: two, id: "project_a", multiple: true })).toBe(two);
    expect(withoutId({ target: two, id: "project_a" })).toBe("project_b");
  });
});

describe("given stored rules naming targets by id", () => {
  /** @scenario "an existing rule that holds raw ids shows their names" */
  it("collects every organization, project and user id once", () => {
    expect(
      targetIdsOf([
        { match: { organizationId: "organization_a" }, enabled: true },
        { match: { projectId: ["project_a", "project_b"] }, enabled: true },
        { match: { projectId: "project_a", userId: "user_a" }, enabled: false },
        { match: {}, enabled: false },
      ]),
    ).toEqual({
      organizationIds: ["organization_a"],
      projectIds: ["project_a", "project_b"],
      userIds: ["user_a"],
    });
  });
});
