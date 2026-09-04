import { describe, expect, it } from "vitest";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { EvaluatorCodeService } from "../evaluator-code.service";
import type { EvaluatorCodeExecutionPort } from "../../ports/evaluator.port";
import type { EvaluatorRepository } from "../../repositories/evaluator.repository";
import type { Evaluator } from "@langwatch/evaluator-contract";

const savedEvaluator: Evaluator = {
  id: "evaluator_code_errors_test",
  projectId: "test-project-id",
  name: "Conversion Test Evaluator",
  slug: "conversion-test-evaluator",
  type: "code",
  config: {
    code: "class Code:\n    def __call__(self, output: str):\n        ...\n",
    inputs: [{ identifier: "output", type: "str" }],
    outputs: [
      { identifier: "passed", type: "bool" },
      { identifier: "score", type: "float" },
    ],
  },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildService(codeExecution: EvaluatorCodeExecutionPort) {
  const repository = {
    findById: async () => savedEvaluator,
  } as unknown as EvaluatorRepository;
  const workflows = {
    enrichStudioEvent: async ({ event }: { event: StudioClientEvent }) => event,
  } as never;

  return EvaluatorCodeService.create({
    repository,
    workflows,
    codeExecution,
    generateId: () => "fixed-id",
  });
}

describe("EvaluatorCodeService execute", () => {
  describe("when the code raises an exception", () => {
    /** @scenario Code evaluator code errors surface per row */
    it("surfaces the exception message as the error result", async () => {
      const service = buildService({
        execute: async () => ({
          ok: true,
          statusText: "OK",
          body: {
            status: "error",
            error: {
              message: "intentional kaboom",
              traceback: "Traceback (most recent call last): ...",
            },
          },
        }),
      });

      const result = await service.execute({
        projectId: "test-project-id",
        evaluatorId: "evaluator_code_errors_test",
        data: { output: "boom" },
      });

      expect(result.status).toBe("error");
      if (result.status !== "error") throw new Error("unreachable");
      expect(result.details).toBe("intentional kaboom");
      expect(result.traceback?.[0]).toContain("Traceback");
    });
  });
});
