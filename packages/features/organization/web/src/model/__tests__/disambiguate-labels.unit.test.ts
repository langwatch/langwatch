/**
 * Two projects called "Personal Workspace" under different teams are two
 * different projects, and a filter that lists them both as "Personal Workspace"
 * gives the reader no way to pick the one they meant.
 *
 * Moved from `platform/app/src/utils/__tests__/disambiguateLabels.unit.test.ts`
 * with the helper it drove: the audit trail's Project filter was its only
 * caller, so both travel and the platform pair is deleted.
 */

import { describe, expect, it } from "vitest";
import { disambiguateLabels } from "../disambiguate-labels";

describe("given a list of labels", () => {
  describe("when none of them collide", () => {
    it("leaves every displayed label exactly as it was", () => {
      const disambiguated = disambiguateLabels(
        [
          { id: "a", label: "Acme" },
          { id: "b", label: "Globex" },
        ],
        () => "should-not-be-used",
      );

      expect(disambiguated).toEqual([
        { id: "a", label: "Acme", displayLabel: "Acme" },
        { id: "b", label: "Globex", displayLabel: "Globex" },
      ]);
    });
  });

  describe("when two of them collide", () => {
    it("appends the suffix to both", () => {
      const disambiguated = disambiguateLabels(
        [
          { id: "a", label: "Personal Workspace", parent: "ariana" },
          { id: "b", label: "Personal Workspace", parent: "rogerio" },
        ],
        (item) => item.parent,
      );

      expect(disambiguated[0]?.displayLabel).toBe("Personal Workspace · ariana");
      expect(disambiguated[1]?.displayLabel).toBe("Personal Workspace · rogerio");
    });
  });

  describe("when only some of them collide", () => {
    it("touches the colliding entries and leaves the rest alone", () => {
      const disambiguated = disambiguateLabels(
        [
          { id: "a", label: "Engineering", parent: "acme" },
          { id: "b", label: "Personal Workspace", parent: "ariana" },
          { id: "c", label: "Personal Workspace", parent: "rogerio" },
          { id: "d", label: "Marketing", parent: "acme" },
        ],
        (item) => item.parent,
      );

      expect(disambiguated.map((entry) => entry.displayLabel)).toEqual([
        "Engineering",
        "Personal Workspace · ariana",
        "Personal Workspace · rogerio",
        "Marketing",
      ]);
    });
  });

  describe("when three or more collide", () => {
    it("disambiguates all of them", () => {
      const disambiguated = disambiguateLabels(
        [
          { id: "1", label: "Default Team", parent: "acme" },
          { id: "2", label: "Default Team", parent: "globex" },
          { id: "3", label: "Default Team", parent: "initech" },
        ],
        (item) => item.parent,
      );

      expect(disambiguated.map((entry) => entry.displayLabel)).toEqual([
        "Default Team · acme",
        "Default Team · globex",
        "Default Team · initech",
      ]);
    });
  });

  describe("when the list is empty", () => {
    it("answers an empty list", () => {
      expect(disambiguateLabels([], () => "x")).toEqual([]);
    });
  });
});
