import { describe, expect, it } from "vitest";
import { mapEvaluatorResult } from "../experiment-result-mapping.process";

describe("mapEvaluatorResult", () => {
  describe("given the evaluator failed with provider auth", () => {
    /** @scenario Judge auth failures are serialized as domain errors */
    it("serializes a domain error for raw 403 responses", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "error",
        error: '403 {\n  "message": "Missing Authentication Token"\n}',
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result.domainError).toMatchObject({
          kind: "evaluator_execution_error",
          meta: { httpStatus: 403 },
        });
        expect(result.result.details).toContain("Missing Authentication Token");
      }
    });

    it("does not reclassify non-auth error strings", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "error",
        error: "Evaluator timeout",
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result.domainError).toBeUndefined();
      }
    });
  });
});
