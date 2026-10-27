import { describe, expect, it } from "vitest";

import { deriveEvaluatorId } from "../evaluator-requirements.ts";

const derive = (name: string): string => deriveEvaluatorId({ name });

describe("deriveEvaluatorId", () => {
  describe("given an evaluation name", () => {
    describe("when its evaluator id is derived", () => {
      /** @scenario "Every derived id is prefixed as a custom evaluator" */
      it("prefixes the id as a custom evaluator", () => {
        expect(derive("Answer Relevancy")).toBe("customeval_answer_relevancy");
      });

      /** @scenario "An underscore survives as a separator rather than vanishing" */
      it("reads each pre-replaced character as a separator", () => {
        expect(derive("answer_relevancy")).toBe("customeval_answer_relevancy");
        expect(derive("answer:relevancy")).toBe("customeval_answer_relevancy");
        expect(derive("answer?relevancy")).toBe("customeval_answer_relevancy");
        expect(derive("answer&relevancy")).toBe("customeval_answer_relevancy");
      });

      it("lower-cases and strips what strict mode removes", () => {
        expect(derive("Ragas — Faithfulness!")).toBe("customeval_ragas_faithfulness");
      });
    });
  });

  describe("given an empty name", () => {
    describe("when its evaluator id is derived", () => {
      /** @scenario "An unnamed evaluation gets a stable placeholder" */
      it("uses the placeholder rather than an empty slug", () => {
        expect(derive("")).toBe("customeval_unnamed");
      });
    });
  });
});
