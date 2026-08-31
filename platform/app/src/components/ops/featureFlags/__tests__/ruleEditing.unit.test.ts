/**
 * @vitest-environment node
 *
 * Placement and translation for the targeting-rules editor. Both are easy to
 * get subtly wrong in ways the dialog still renders happily: a rule appended
 * below a catch-all looks live and can never fire, and a scope change that
 * keeps the previous field value writes a rule that matches nothing.
 */
import { describe, expect, it } from "vitest";
import {
  findUnfillableRule,
  insertionIndexForNewRule,
  newRule,
  rulesToUI,
  type UIRule,
  uiToRules,
  withRuleAdded,
  withRuleMoved,
} from "../ruleEditing";

function rule(overrides: Partial<UIRule>): UIRule {
  return { ...newRule(), ...overrides };
}

describe("given the rules for a flag end with a rule that applies to everyone", () => {
  describe("when the operator adds a rule", () => {
    /** @scenario "a new rule lands above a trailing everyone rule" */
    it("places it directly above the everyone rule", () => {
      const rules = [
        rule({ scopeKind: "ORGANIZATION", target: "organization_a" }),
        rule({ scopeKind: "EVERYONE", target: "", enabled: false }),
      ];

      const added = rule({ scopeKind: "PROJECT", target: "project_b" });
      const next = withRuleAdded(rules, added);

      expect(insertionIndexForNewRule(rules)).toBe(1);
      expect(next.map((r) => r.scopeKind)).toEqual([
        "ORGANIZATION",
        "PROJECT",
        "EVERYONE",
      ]);
      // The reason for the placement, stated as an assertion: a rule below
      // the catch-all can never be reached by the first-match-wins walk.
      expect(next[next.length - 1]?.scopeKind).toBe("EVERYONE");
    });
  });
});

describe("given the rules for a flag do not end with an everyone rule", () => {
  describe("when the operator adds a rule", () => {
    /** @scenario "a new rule is appended when the list does not end in everyone" */
    it("appends it, which is where the lowest-priority rule belongs", () => {
      const rules = [
        rule({ scopeKind: "EVERYONE", target: "" }),
        rule({ scopeKind: "ORGANIZATION", target: "organization_a" }),
      ];

      const next = withRuleAdded(rules, rule({ target: "organization_b" }));

      expect(next).toHaveLength(3);
      expect(next[2]?.target).toBe("organization_b");
    });
  });

  describe("when the list is empty", () => {
    it("adds the rule as the only one", () => {
      expect(
        withRuleAdded([], rule({ target: "organization_a" })),
      ).toHaveLength(1);
    });
  });
});

describe("given an operator drags one rule onto another", () => {
  /** @scenario "an operator reorders rules by dragging them" */
  it("moves it to that position, changing which rule is evaluated first", () => {
    const first = rule({ target: "organization_a" });
    const second = rule({ target: "organization_b" });
    const third = rule({ target: "organization_c" });

    const moved = withRuleMoved([first, second, third], {
      fromId: third.id,
      toId: first.id,
    });

    expect(moved.map((r) => r.target)).toEqual([
      "organization_c",
      "organization_a",
      "organization_b",
    ]);
  });

  describe("when the rule is dropped where it started", () => {
    it("returns the list untouched", () => {
      const rules = [rule({ target: "organization_a" })];

      expect(
        withRuleMoved(rules, { fromId: rules[0]!.id, toId: rules[0]!.id }),
      ).toBe(rules);
      expect(withRuleMoved(rules, { fromId: "gone", toId: rules[0]!.id })).toBe(
        rules,
      );
    });
  });
});

describe("translating between stored rules and the editor", () => {
  describe("given a stored rule naming an organization creation date", () => {
    /** @scenario "a saved New users rule reopens as a New users rule" */
    it("reopens as a New users rule with that date", () => {
      const [uiRule] = rulesToUI([
        { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
      ]);

      expect(uiRule?.scopeKind).toBe("NEW_USERS");
      expect(uiRule?.target).toBe("2026-06-01");
    });

    it("narrows a full timestamp to the day, so the date field can show it", () => {
      const [uiRule] = rulesToUI([
        {
          match: { organizationCreatedAfter: "2026-06-01T10:30:00.000Z" },
          enabled: true,
        },
      ]);

      expect(uiRule?.target).toBe("2026-06-01");
    });
  });

  describe("given a New users rule in the editor", () => {
    it("saves it as an organization creation date, not as an id", () => {
      expect(
        uiToRules([
          rule({
            scopeKind: "NEW_USERS",
            target: " 2026-06-01 ",
            enabled: true,
          }),
        ]),
      ).toEqual([
        { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
      ]);
    });
  });

  describe("given every scope kind", () => {
    it("round-trips through the stored shape unchanged", () => {
      const stored = [
        { match: { organizationId: "organization_a" }, enabled: true },
        { match: { projectId: "project_b" }, enabled: false },
        { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
        { match: {}, enabled: false },
      ];

      expect(uiToRules(rulesToUI(stored))).toEqual(stored);
    });
  });

  describe("given no stored rules", () => {
    it("seeds one organization rule so the operator sees the shape to fill in", () => {
      const seeded = rulesToUI([]);

      expect(seeded).toHaveLength(1);
      expect(seeded[0]?.scopeKind).toBe("ORGANIZATION");
      expect(seeded[0]?.target).toBe("");
    });
  });

  it("gives every rule an identity of its own, even for identical rules", () => {
    const ids = rulesToUI([
      { match: { organizationId: "organization_a" }, enabled: true },
      { match: { organizationId: "organization_a" }, enabled: true },
    ]).map((r) => r.id);

    expect(new Set(ids).size).toBe(2);
  });
});

describe("findUnfillableRule", () => {
  describe("when a New users rule has no date", () => {
    it("reports it, because a rule that cannot match reads as live", () => {
      const empty = rule({ scopeKind: "NEW_USERS", target: "" });

      expect(findUnfillableRule([empty])?.id).toBe(empty.id);
    });
  });

  describe("when only the everyone rule has an empty field", () => {
    it("reports nothing, because that rule needs no target", () => {
      expect(
        findUnfillableRule([rule({ scopeKind: "EVERYONE", target: "" })]),
      ).toBeUndefined();
    });
  });
});
