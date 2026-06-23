import { describe, expect, it } from "vitest";

import { evalDefinitionTarget } from "../EvaluationsCell";

describe("evalDefinitionTarget", () => {
  describe("given a langevals built-in evaluator type", () => {
    describe("when resolving the definition target", () => {
      it("has no definition (the id carries a slash)", () => {
        expect(evalDefinitionTarget("ragas/faithfulness")).toBeNull();
        expect(
          evalDefinitionTarget("langevals/competitor_blocklist"),
        ).toBeNull();
      });
    });
  });

  describe("given a configured evaluator id", () => {
    describe("when resolving the definition target", () => {
      it("opens the evaluator editor", () => {
        expect(evalDefinitionTarget("evaluator_abc123")).toEqual({
          drawer: "evaluatorEditor",
          evaluatorId: "evaluator_abc123",
        });
      });
    });
  });

  describe("given a legacy online monitor id", () => {
    describe("when resolving the definition target", () => {
      it("opens the online-evaluation drawer", () => {
        expect(evalDefinitionTarget("check_xyz789")).toEqual({
          drawer: "onlineEvaluation",
          monitorId: "check_xyz789",
        });
      });
    });
  });

  describe("given a missing id", () => {
    describe("when resolving the definition target", () => {
      it("has no definition", () => {
        expect(evalDefinitionTarget(null)).toBeNull();
        expect(evalDefinitionTarget(undefined)).toBeNull();
        expect(evalDefinitionTarget("")).toBeNull();
      });
    });
  });
});
