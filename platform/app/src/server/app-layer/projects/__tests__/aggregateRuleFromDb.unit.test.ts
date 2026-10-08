/**
 * ADR-144 block E: the reconciler reads an aggregate's stored rule through
 * the schema, never a cast. A column that does not parse is "no rule".
 *
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";
import { aggregateRuleFromDb } from "../aggregate-rule";

describe("aggregateRuleFromDb", () => {
  describe("when the stored column holds a valid rule", () => {
    it("returns each rule kind as stored", () => {
      expect(aggregateRuleFromDb({ kind: "all-personal" })).toEqual({
        kind: "all-personal",
      });
      expect(
        aggregateRuleFromDb({
          kind: "personal-by-department",
          departmentId: "dep_eng",
        }),
      ).toEqual({ kind: "personal-by-department", departmentId: "dep_eng" });
      expect(
        aggregateRuleFromDb({ kind: "explicit", projectIds: ["p_1", "p_2"] }),
      ).toEqual({ kind: "explicit", projectIds: ["p_1", "p_2"] });
    });
  });

  describe("when the stored rule predates naming projects on a personal rule", () => {
    /** @scenario "A rule stored before it could name projects still reads" */
    it("reads it as every personal project, with no named projects", () => {
      const rule = aggregateRuleFromDb({ kind: "all-personal" });
      expect(rule).toEqual({ kind: "all-personal" });
      expect(rule).not.toHaveProperty("projectIds");
    });
  });

  describe("when the stored rule names projects on top of the personal ones", () => {
    it("returns the named projects with it", () => {
      expect(
        aggregateRuleFromDb({ kind: "all-personal", projectIds: ["p_1"] }),
      ).toEqual({ kind: "all-personal", projectIds: ["p_1"] });
      expect(
        aggregateRuleFromDb({
          kind: "personal-by-department",
          departmentId: "dep_eng",
          projectIds: ["p_1"],
        }),
      ).toEqual({
        kind: "personal-by-department",
        departmentId: "dep_eng",
        projectIds: ["p_1"],
      });
    });
  });

  describe("when the stored column is malformed", () => {
    it.each([
      ["an unknown kind", { kind: "everything" }],
      [
        "an explicit rule with no projects",
        { kind: "explicit", projectIds: [] },
      ],
      [
        "a department rule with no department",
        { kind: "personal-by-department" },
      ],
      ["an extra field", { kind: "all-personal", where: "x" }],
      [
        "a personal rule naming an empty list",
        { kind: "all-personal", projectIds: [] },
      ],
      ["a string", "all-personal"],
      ["an array", [{ kind: "all-personal" }]],
    ])("reads %s as no rule", (_label, stored) => {
      expect(aggregateRuleFromDb(stored)).toBeNull();
    });
  });

  describe("when the stored column is empty", () => {
    it("reads null and undefined as no rule", () => {
      expect(aggregateRuleFromDb(null)).toBeNull();
      expect(aggregateRuleFromDb(undefined)).toBeNull();
    });
  });
});
