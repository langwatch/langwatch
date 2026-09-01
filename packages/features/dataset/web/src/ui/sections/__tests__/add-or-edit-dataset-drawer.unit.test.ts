/**
 * What the dataset form refuses to submit.
 *
 * The platform drawer stated these three rules inside a `react-hook-form`
 * resolver, where they were only observable through the form's side effects.
 * This package drives the form with plain state, so the rules are one function
 * and the assertion is on its answer.
 *
 * Spec: specs/datasets/datasets-list-page.feature.
 */

import { describe, expect, it } from "vitest";
import { describeProblems } from "../add-or-edit-dataset-drawer";

const column = (name: string) => ({ name, type: "string" }) as const;

describe("describeProblems", () => {
  describe("given a named dataset with distinct, non-empty columns", () => {
    it("finds nothing wrong", () => {
      expect(describeProblems({ name: "offline evals", columnTypes: [column("input")] })).toEqual(
        {},
      );
    });
  });

  describe("given a dataset with no name", () => {
    it("requires one, and treats whitespace as none", () => {
      expect(describeProblems({ name: "", columnTypes: [column("input")] }).name).toBe(
        "Name is required",
      );
      expect(describeProblems({ name: "   ", columnTypes: [column("input")] }).name).toBe(
        "Name is required",
      );
    });
  });

  describe("given a column with no name", () => {
    it("refuses it, because normalize would drop its values", () => {
      expect(
        describeProblems({ name: "evals", columnTypes: [column("input"), column("")] }).columnTypes,
      ).toBe("Column name cannot be empty");
    });
  });

  describe("given two columns that share a name", () => {
    it("names the collision, because normalize would merge their values", () => {
      expect(
        describeProblems({
          name: "evals",
          columnTypes: [column("input"), column("input")],
        }).columnTypes,
      ).toBe("Cannot have multiple columns with the same name: `input`");
    });
  });

  describe("given both an empty name and a duplicate column", () => {
    it("reports each field once, so neither hides the other", () => {
      const problems = describeProblems({
        name: "",
        columnTypes: [column("input"), column("input")],
      });

      expect(problems.name).toBe("Name is required");
      expect(problems.columnTypes).toBe("Cannot have multiple columns with the same name: `input`");
    });
  });
});
