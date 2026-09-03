/**
 * @see specs/experiments-v3/evaluator-naming.feature
 */
import { describe, expect, it } from "vitest";
import type { EvaluatorConfig } from "../../../model/experiments-v3/types";
import { resolveEvaluatorName } from "../use-evaluator-name";

const evaluator = (over: Partial<EvaluatorConfig> = {}): EvaluatorConfig =>
  ({
    id: "evaluator_AzPF-HSd",
    evaluatorType: "langevals/exact_match",
    inputs: [],
    mappings: {},
    ...over,
  }) as EvaluatorConfig;

describe("given an evaluator to name on a chip", () => {
  describe("when it carries no name and no database evaluator", () => {
    /** @scenario "A chip reads the evaluator type when no name is stored" */
    it("reads the name of its type", () => {
      expect(resolveEvaluatorName({ evaluator: evaluator() })).toBe("Exact Match Evaluator");
    });

    /** @scenario "A chip reads the evaluator type when no name is stored" */
    it("never reads the config id", () => {
      expect(resolveEvaluatorName({ evaluator: evaluator() })).not.toContain("evaluator_AzPF-HSd");
    });
  });

  describe("when the workbench holds a name", () => {
    /** @scenario "A name set in the workbench wins over the type name" */
    it("reads that name", () => {
      expect(
        resolveEvaluatorName({
          evaluator: evaluator({ localEvaluatorConfig: { name: "l3 exact match" } }),
          dbName: "Category match",
        }),
      ).toBe("l3 exact match");
    });
  });

  describe("when only the database evaluator has a name", () => {
    /** @scenario "A database evaluator name wins over the type name" */
    it("reads the database name", () => {
      expect(
        resolveEvaluatorName({
          evaluator: evaluator({ dbEvaluatorId: "db-1" }),
          dbName: "Category match",
        }),
      ).toBe("Category match");
    });
  });

  describe("when the stored name is empty or only spaces", () => {
    it.each(["", "   "])("falls through past %j", (name) => {
      expect(
        resolveEvaluatorName({
          evaluator: evaluator({ localEvaluatorConfig: { name } }),
        }),
      ).toBe("Exact Match Evaluator");
    });
  });

  describe("when the type is a project's own evaluator the catalog has no entry for", () => {
    it("reads the type, which still says more than the id", () => {
      expect(
        resolveEvaluatorName({
          evaluator: evaluator({
            evaluatorType: "custom/evaluator_abc" as EvaluatorConfig["evaluatorType"],
          }),
        }),
      ).toBe("custom/evaluator_abc");
    });
  });

  describe("when the database name has not arrived yet", () => {
    /**
     * The query is in flight on the first render. The chip has to read
     * something, and a type name is the answer that does not flash an id.
     */
    it("reads the type name rather than the id", () => {
      expect(
        resolveEvaluatorName({
          evaluator: evaluator({ dbEvaluatorId: "db-1" }),
          dbName: undefined,
        }),
      ).toBe("Exact Match Evaluator");
    });
  });
});
