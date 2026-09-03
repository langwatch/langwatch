import { describe, expect, it } from "vitest";
import { EvaluationNameAutoslugService } from "../evaluation-name-autoslug.service";

const evaluationNameAutoslug = (name: string): string =>
  EvaluationNameAutoslugService.create().derive(name);

describe("EvaluationNameAutoslugService", () => {
  describe("given an evaluation name", () => {
    describe("when its evaluator id is derived", () => {
      /** @scenario "Every derived id is prefixed as a custom evaluator" */
      it("prefixes the id as a custom evaluator", () => {
        expect(evaluationNameAutoslug("Answer Relevancy")).toBe("customeval_answer_relevancy");
      });

      // The four pre-replaced characters and the three slugify options are a
      // wire format: the derived id IS the evaluator's key, so a name that
      // slugs differently in two processes becomes two evaluators.
      /** @scenario "An underscore survives as a separator rather than vanishing" */
      it("reads each pre-replaced character as a separator", () => {
        expect(evaluationNameAutoslug("answer_relevancy")).toBe("customeval_answer_relevancy");
        expect(evaluationNameAutoslug("answer:relevancy")).toBe("customeval_answer_relevancy");
        expect(evaluationNameAutoslug("answer?relevancy")).toBe("customeval_answer_relevancy");
        expect(evaluationNameAutoslug("answer&relevancy")).toBe("customeval_answer_relevancy");
      });

      it("lower-cases and strips what strict mode removes", () => {
        expect(evaluationNameAutoslug("Ragas — Faithfulness!")).toBe(
          "customeval_ragas_faithfulness",
        );
      });
    });
  });

  describe("given an empty name", () => {
    describe("when its evaluator id is derived", () => {
      /** @scenario "An unnamed evaluation gets a stable placeholder" */
      it("uses the placeholder rather than an empty slug", () => {
        expect(evaluationNameAutoslug("")).toBe("customeval_unnamed");
      });
    });
  });
});
