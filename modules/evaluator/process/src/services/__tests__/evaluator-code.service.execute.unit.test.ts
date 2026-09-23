import type { Evaluator } from "@langwatch/evaluator-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type { EvaluatorRepository } from "../../repositories/evaluator.repository.ts";
import type { EvaluatorCodeExecution } from "../evaluator-code-execution.service.ts";
import { EvaluatorCodeService } from "../evaluator-code.service.ts";

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

function notUsedHere(): Promise<never> {
  return Promise.reject(new Error("this repository member is not used in this case"));
}

function unusedRepository(): EvaluatorRepository {
  return {
    findById: notUsedHere,
    findByIdAcrossProjects: notUsedHere,
    findBySlug: notUsedHere,
    findByWorkflow: notUsedHere,
    findByIdOrSlug: notUsedHere,
    findAll: notUsedHere,
    findCopies: notUsedHere,
    create: notUsedHere,
    update: notUsedHere,
    archive: notUsedHere,
    updateNameAndConfig: notUsedHere,
  };
}

function buildService(codeExecution: EvaluatorCodeExecution) {
  const repository: EvaluatorRepository = {
    ...unusedRepository(),
    findById: async () => savedEvaluator,
  };
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
