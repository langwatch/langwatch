/**
 * ADR-177 block D: the shapes an aggregate rule accepts, and how a stored column reads.
 * Ported from main's aggregate-rule and aggregateRuleFromDb unit tests; the repositories
 * read the column as `aggregateRuleSchema.safeParse(...).data ?? null`.
 * @see modules/project/specs/aggregate-rule-shape.feature
 */
import { describe, expect, it } from "vitest";

import {
  AGGREGATE_DEFAULT_RULE,
  AGGREGATE_RULE_KINDS,
  aggregateRuleSchema,
} from "../project.aggregate-rule.ts";

/** The read both project repositories make of `Project.aggregateRule`. */
const storedRule = (column: unknown) => aggregateRuleSchema.safeParse(column).data ?? null;

describe("given the aggregate rule shapes", () => {
  /** @scenario "The rule names exactly three kinds and defaults to all personal projects" */
  it("names the three kinds the ADR fixes, and defaults to all personal projects", () => {
    expect(AGGREGATE_RULE_KINDS).toEqual(["all-personal", "personal-by-department", "explicit"]);
    expect(aggregateRuleSchema.parse(AGGREGATE_DEFAULT_RULE)).toEqual({ kind: "all-personal" });
  });

  /** @scenario "An explicit rule with no projects or a rule with stray fields is refused" */
  it("refuses an explicit rule with no projects and a shape with stray fields", () => {
    expect(aggregateRuleSchema.validate({ kind: "explicit", projectIds: [] })).toBe(false);
    expect(aggregateRuleSchema.validate({ kind: "all-personal", where: "x" })).toBe(false);
  });
});

describe("given a stored aggregate rule column", () => {
  describe("when it holds a valid rule", () => {
    /** @scenario "A stored rule that does not parse reads as no rule" */
    it("returns each rule kind as stored", () => {
      expect(storedRule({ kind: "all-personal" })).toEqual({ kind: "all-personal" });
      expect(storedRule({ kind: "personal-by-department", departmentId: "dep_eng" })).toEqual({
        kind: "personal-by-department",
        departmentId: "dep_eng",
      });
      expect(storedRule({ kind: "explicit", projectIds: ["p_1", "p_2"] })).toEqual({
        kind: "explicit",
        projectIds: ["p_1", "p_2"],
      });
    });
  });

  describe("when it is malformed", () => {
    /** @scenario "A stored rule that does not parse reads as no rule" */
    it.each([
      ["an unknown kind", { kind: "everything" }],
      ["an explicit rule with no projects", { kind: "explicit", projectIds: [] }],
      ["a department rule with no department", { kind: "personal-by-department" }],
      ["an extra field", { kind: "all-personal", where: "x" }],
      ["a string", "all-personal"],
      ["an array", [{ kind: "all-personal" }]],
    ])("reads %s as no rule", (_label, stored) => {
      expect(storedRule(stored)).toBeNull();
    });
  });

  describe("when it is empty", () => {
    /** @scenario "A stored rule that does not parse reads as no rule" */
    it("reads null and undefined as no rule", () => {
      expect(storedRule(null)).toBeNull();
      expect(storedRule(undefined)).toBeNull();
    });
  });
});
