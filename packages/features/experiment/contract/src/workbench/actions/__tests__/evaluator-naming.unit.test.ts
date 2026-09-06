/**
 * @see specs/experiments-v3/evaluator-naming.feature
 */
import { describe, expect, it } from "vitest";
import { addEvaluatorPayloadSchema } from "../schemas";
import { addEvaluator } from "../transforms";
import { baseState } from "./workbench-fixtures";

const exactMatch = (name: string) => ({
  name,
  evaluatorType: "langevals/exact_match",
  inputs: [],
});

describe("given an agent adding an evaluator", () => {
  describe("when the payload carries no name", () => {
    /** @scenario "An agent must name the evaluator it adds" */
    it("refuses on the name field", () => {
      const result = addEvaluatorPayloadSchema.safeParse({
        evaluatorType: "langevals/exact_match",
        inputs: [],
      });

      expect(result.success).toBe(false);
      expect(
        result.success ? [] : result.error.issues.map((issue) => issue.path.join(".")),
      ).toContain("name");
    });

    /** @scenario "An agent must name the evaluator it adds" */
    it("leaves the workbench with the evaluators it had", () => {
      const state = baseState();

      expect(() =>
        addEvaluator({
          state,
          payload: {
            evaluatorType: "langevals/exact_match",
            inputs: [],
          } as never,
        }),
      ).toThrow();
      expect(state.evaluators).toHaveLength(1);
    });
  });

  describe("when the name is blank or only spaces", () => {
    /** @scenario "An agent must name the evaluator it adds" */
    it.each(["", "   "])("refuses %j rather than storing an empty name", (name) => {
      expect(addEvaluatorPayloadSchema.safeParse(exactMatch(name)).success).toBe(false);
    });
  });

  describe("when two evaluators of one type are added", () => {
    /** @scenario "Two evaluators of one type keep the names they were given" */
    it("keeps the name each one was given", () => {
      const first = addEvaluator({
        state: baseState(),
        payload: exactMatch("l1 exact match"),
      });
      const second = addEvaluator({
        state: first.state,
        payload: exactMatch("l2 exact match"),
      });

      expect(second.state.evaluators.map((e) => e.localEvaluatorConfig?.name)).toEqual([
        undefined,
        "l1 exact match",
        "l2 exact match",
      ]);
    });

    // The execution side reads `localEvaluatorConfig?.settings` and falls
    // through to the database config when it is absent. A name written on its
    // own must not read as an empty settings override.
    /** @scenario "Two evaluators of one type keep the names they were given" */
    it("overrides no settings by naming the evaluator", () => {
      const { state } = addEvaluator({
        state: baseState(),
        payload: exactMatch("l1 exact match"),
      });

      expect(state.evaluators[1]?.localEvaluatorConfig?.settings).toBeUndefined();
    });
  });

  describe("when the payload also carries local settings", () => {
    it("keeps the settings and adds the name beside them", () => {
      const { state } = addEvaluator({
        state: baseState(),
        payload: {
          ...exactMatch("l1 exact match"),
          localEvaluatorConfig: { name: "ignored", settings: { strict: true } },
        },
      });

      expect(state.evaluators[1]?.localEvaluatorConfig).toEqual({
        name: "l1 exact match",
        settings: { strict: true },
      });
    });
  });
});
