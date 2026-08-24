import { describe, expect, it, vi } from "vitest";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { EvaluatorNotFoundError } from "@langwatch/evaluator-contract";
import { EvaluatorService } from "../src/services/evaluator.service";
import type { EvaluatorRepository } from "../src/repositories/evaluator.repository";

const evaluator: Evaluator = {
  id: "e1", projectId: "p1", name: "Exact", slug: "exact",
  type: "evaluator", config: { evaluatorType: "langevals/exact_match" },
  workflowId: null, copiedFromEvaluatorId: null, archivedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};

function repository(overrides: Partial<EvaluatorRepository> = {}): EvaluatorRepository {
  return {
    tryFindById: vi.fn().mockResolvedValue(evaluator),
    tryFindByIdOnly: vi.fn().mockResolvedValue(evaluator),
    tryFindBySlug: vi.fn().mockResolvedValue(evaluator),
    tryFindByWorkflow: vi.fn().mockResolvedValue(evaluator),
    findAll: vi.fn().mockResolvedValue([evaluator]),
    create: vi.fn().mockResolvedValue(evaluator),
    update: vi.fn().mockResolvedValue(evaluator),
    archive: vi.fn().mockResolvedValue(evaluator),
    findCopies: vi.fn().mockResolvedValue([]),
    updateNameAndConfig: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as EvaluatorRepository;
}

describe("EvaluatorService", () => {
  it("keeps nullable lookup and throwing lookup distinct", async () => {
    const repo = repository({ tryFindById: vi.fn().mockResolvedValue(null) });
    const service = EvaluatorService.create({ repository: repo, workflows: { assertInProject: vi.fn(), getFields: vi.fn() } });
    await expect(service.tryGetById({ id: "missing", projectId: "p1" })).resolves.toBeNull();
    await expect(service.getById({ id: "missing", projectId: "p1" })).rejects.toBeInstanceOf(EvaluatorNotFoundError);
  });

  it("enriches built-in definitions through the shared service", async () => {
    const service = EvaluatorService.create({ repository: repository(), workflows: { assertInProject: vi.fn(), getFields: vi.fn() } });
    const result = await service.getByIdWithFields({ id: "e1", projectId: "p1" });
    expect(result.id).toBe("e1");
    expect(result.outputFields.length).toBeGreaterThan(0);
  });

  it("keeps workflow entry and end fields separate", async () => {
    const workflowEvaluator: Evaluator = {
      ...evaluator,
      type: "workflow",
      workflowId: "w1",
    };
    const service = EvaluatorService.create({
      repository: repository({ tryFindById: vi.fn().mockResolvedValue(workflowEvaluator) }),
      workflows: {
        assertInProject: vi.fn(),
        getFields: vi.fn().mockResolvedValue({
          workflowId: "w1",
          workflowName: "Workflow",
          fields: [{ identifier: "input", type: "str" }],
          outputFields: [{ identifier: "result", type: "float" }],
        }),
      },
    });
    const result = await service.getByIdWithFields({ id: "e1", projectId: "p1" });
    expect(result.fields).toEqual([{ identifier: "input", type: "str" }]);
    expect(result.outputFields).toEqual([{ identifier: "result", type: "float" }]);
  });
});
