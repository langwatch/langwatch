import { describe, it, expect } from "vitest";

import { disambiguateLabels } from "../disambiguateLabels";

describe("disambiguateLabels", () => {
  describe("when no labels collide", () => {
    it("leaves displayLabel equal to label for every entry", () => {
      const out = disambiguateLabels(
        [
          { id: "a", label: "Acme" },
          { id: "b", label: "Globex" },
        ],
        () => "should-not-be-used",
      );
      expect(out).toEqual([
        { id: "a", label: "Acme", displayLabel: "Acme" },
        { id: "b", label: "Globex", displayLabel: "Globex" },
      ]);
    });
  });

  describe("when two labels collide", () => {
    it("appends the suffix to both entries via ' · '", () => {
      const out = disambiguateLabels(
        [
          { id: "a", label: "Personal Workspace", parent: "ariana" },
          { id: "b", label: "Personal Workspace", parent: "rogerio" },
        ],
        (item) => item.parent,
      );
      expect(out[0]?.displayLabel).toBe("Personal Workspace · ariana");
      expect(out[1]?.displayLabel).toBe("Personal Workspace · rogerio");
    });
  });

  describe("when only some labels in a mixed list collide", () => {
    it("disambiguates only the colliding entries, leaves unique ones intact", () => {
      const out = disambiguateLabels(
        [
          { id: "a", label: "Engineering", parent: "acme" },
          { id: "b", label: "Personal Workspace", parent: "ariana" },
          { id: "c", label: "Personal Workspace", parent: "rogerio" },
          { id: "d", label: "Marketing", parent: "acme" },
        ],
        (item) => item.parent,
      );
      expect(out[0]?.displayLabel).toBe("Engineering");
      expect(out[1]?.displayLabel).toBe("Personal Workspace · ariana");
      expect(out[2]?.displayLabel).toBe("Personal Workspace · rogerio");
      expect(out[3]?.displayLabel).toBe("Marketing");
    });
  });

  describe("when an empty list is passed", () => {
    it("returns an empty list", () => {
      expect(disambiguateLabels([], () => "x")).toEqual([]);
    });
  });

  describe("when three or more labels collide", () => {
    it("disambiguates all of them", () => {
      const out = disambiguateLabels(
        [
          { id: "1", label: "Default Team", parent: "acme" },
          { id: "2", label: "Default Team", parent: "globex" },
          { id: "3", label: "Default Team", parent: "initech" },
        ],
        (item) => item.parent,
      );
      expect(out.map((o) => o.displayLabel)).toEqual([
        "Default Team · acme",
        "Default Team · globex",
        "Default Team · initech",
      ]);
    });
  });
});
