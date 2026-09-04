import { describe, expect, it } from "vitest";
import type { Evaluator, PersistEvaluatorInput } from "@langwatch/evaluator-contract";
import { EvaluatorService } from "../evaluator.service";
import type { EvaluatorRepository } from "../../repositories/evaluator.repository";
import type { EvaluatorCodeExecutionPort } from "../../ports/evaluator.port";

function buildService() {
  const created: PersistEvaluatorInput[] = [];
  const repository = {
    create: async (input: PersistEvaluatorInput) => {
      created.push(input);
      return {
        ...input,
        slug: input.slug ?? null,
        workflowId: input.workflowId ?? null,
        copiedFromEvaluatorId: input.copiedFromEvaluatorId ?? null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies Evaluator;
    },
    findById: async ({ id, projectId }: { id: string; projectId: string }) => {
      const match = created.find((c) => c.id === id && c.projectId === projectId);
      if (!match) throw new Error("not found");
      return {
        ...match,
        slug: match.slug ?? null,
        workflowId: match.workflowId ?? null,
        copiedFromEvaluatorId: match.copiedFromEvaluatorId ?? null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies Evaluator;
    },
    findAll: async ({ projectId }: { projectId: string }) =>
      created
        .filter((c) => c.projectId === projectId)
        .map(
          (match) =>
            ({
              ...match,
              slug: match.slug ?? null,
              workflowId: match.workflowId ?? null,
              copiedFromEvaluatorId: match.copiedFromEvaluatorId ?? null,
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }) satisfies Evaluator,
        ),
  } as unknown as EvaluatorRepository;

  const workflows = {} as never;
  const codeExecution = {} as EvaluatorCodeExecutionPort;

  return EvaluatorService.create({
    repository,
    workflows,
    codeExecution,
    generateId: () => "generated-id",
  });
}

describe("EvaluatorService create with a code evaluator", () => {
  describe("given valid code, inputs and outputs", () => {
    /** @scenario Create a code evaluator from the drawer */
    it("creates a code evaluator with the code in its config and no workflow record", async () => {
      const service = buildService();

      const result = await service.create({
        id: "evaluator_code_1",
        projectId: "test-project-id",
        name: "My Code Evaluator",
        type: "code",
        config: {
          code: 'class Code:\n    def __call__(self, output: str):\n        return {"passed": True}\n',
          inputs: [{ identifier: "output", type: "str" }],
          outputs: [{ identifier: "passed", type: "bool" }],
        },
      });

      expect(result.type).toBe("code");
      expect(result.workflowId).toBeNull();
      expect((result.config as { code: string }).code).toContain("class Code");
    });
  });

  describe("given an invalid code evaluator config", () => {
    /** @scenario Create a code evaluator from the drawer */
    it("rejects the create with no code, inputs, or outputs", async () => {
      const service = buildService();

      await expect(
        service.create({
          id: "evaluator_code_broken",
          projectId: "test-project-id",
          name: "Broken Code Evaluator",
          type: "code",
          config: { inputs: [], outputs: [] },
        }),
      ).rejects.toThrow();
    });
  });

  describe("given a saved code evaluator", () => {
    /** @scenario Code evaluator inputs drive the mapping UI */
    it("computes its fields and output fields from the config", async () => {
      const service = buildService();

      const created = await service.create({
        id: "evaluator_code_fields",
        projectId: "test-project-id",
        name: "Fields Code Evaluator",
        type: "code",
        config: {
          code: 'class Code:\n    def __call__(self, output: str, expected_output: str):\n        return {"passed": True, "score": 1.0}\n',
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          outputs: [
            { identifier: "passed", type: "bool" },
            { identifier: "score", type: "float" },
          ],
        },
      });

      const withFields = await service.getAllWithFields({ projectId: "test-project-id" });
      const fetched = withFields.find((e) => e.id === created.id);

      expect(fetched?.fields.map((f) => f.identifier)).toEqual(["output", "expected_output"]);
      expect(fetched?.outputFields.map((f) => f.identifier)).toEqual(["passed", "score"]);
    });
  });
});
