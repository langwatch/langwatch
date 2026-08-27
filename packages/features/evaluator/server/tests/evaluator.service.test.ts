import { describe, expect, it, vi } from "vitest";
import {
  EvaluatorNotFoundError,
  EvaluatorWorkflowAlreadyAssignedError,
  standardEvaluatorOutputFields,
  type Evaluator,
} from "@langwatch/evaluator-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { EvaluatorRepository } from "../src/repositories/evaluator.repository";
import { EvaluatorCodeExecutionPort } from "../src/ports/evaluator.port";
import { EvaluatorService } from "../src/services/evaluator.service";

const baseEvaluator: Evaluator = {
  id: "e1",
  projectId: "p1",
  name: "Exact",
  slug: "exact",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function evaluator(overrides: Partial<Evaluator> = {}): Evaluator {
  return { ...baseEvaluator, ...overrides };
}

function repository(overrides: Partial<EvaluatorRepository> = {}): EvaluatorRepository {
  return {
    tryFindById: vi.fn().mockResolvedValue(baseEvaluator),
    tryFindByIdOnly: vi.fn().mockResolvedValue(baseEvaluator),
    tryFindBySlug: vi.fn().mockResolvedValue(baseEvaluator),
    tryFindByWorkflow: vi.fn().mockResolvedValue(baseEvaluator),
    findAll: vi.fn().mockResolvedValue([baseEvaluator]),
    create: vi.fn().mockResolvedValue(baseEvaluator),
    update: vi.fn().mockResolvedValue(baseEvaluator),
    archive: vi.fn().mockResolvedValue(baseEvaluator),
    findCopies: vi.fn().mockResolvedValue([]),
    updateNameAndConfig: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as EvaluatorRepository;
}

function workflows(overrides: Partial<WorkflowService> = {}): WorkflowService {
  return {
    assertInProject: vi.fn().mockResolvedValue(undefined),
    getFields: vi.fn().mockResolvedValue({
      workflowId: "w1",
      workflowName: "Workflow",
      fields: [],
      outputFields: [],
    }),
    ...overrides,
  } as WorkflowService;
}

function service(
  options: {
    repository?: EvaluatorRepository;
    workflows?: WorkflowService;
    codeExecution?: EvaluatorCodeExecutionPort;
  } = {},
): EvaluatorService {
  return EvaluatorService.create({
    repository: options.repository ?? repository(),
    workflows: options.workflows ?? workflows(),
    codeExecution: options.codeExecution ?? new (class extends EvaluatorCodeExecutionPort {
      async execute() {
        return {
          ok: true,
          statusText: "OK",
          body: { status: "success", result: {} },
        };
      }
    })(),
    generateId: () => "test",
  });
}

describe("EvaluatorService", () => {
  it("converts a successful code execution into processed scalar results", async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      body: { status: "success", result: { passed: "true", score: "0.75" } },
    });
    const evaluators = service({
      repository: repository({
        tryFindById: vi.fn().mockResolvedValue(
          evaluator({
            type: "code",
            config: {
              code: "class Code: ...",
              inputs: [{ identifier: "output", type: "str" }],
              outputs: [{ identifier: "passed", type: "bool" }],
            },
          }),
        ),
      }),
      workflows: workflows({ enrichStudioEvent: vi.fn(({ event }) => event) }),
      codeExecution: new (class extends EvaluatorCodeExecutionPort {
        execute = execute;
      })(),
    });

    await expect(
      evaluators.executeCode({
        projectId: "p1",
        evaluatorId: "e1",
        data: { output: "hello" },
      }),
    ).resolves.toMatchObject({ status: "processed", passed: true, score: 0.75 });
  });

  it("surfaces code exceptions in the evaluator error envelope", async () => {
    const evaluators = service({
      repository: repository({
        tryFindById: vi.fn().mockResolvedValue(
          evaluator({
            type: "code",
            config: {
              code: "raise ValueError()",
              inputs: [{ identifier: "output", type: "str" }],
              outputs: [{ identifier: "passed", type: "bool" }],
            },
          }),
        ),
      }),
      workflows: workflows({ enrichStudioEvent: vi.fn(({ event }) => event) }),
      codeExecution: new (class extends EvaluatorCodeExecutionPort {
        async execute() {
          return {
            ok: true,
            statusText: "OK",
            body: {
              status: "error",
              error: {
                message: "intentional kaboom",
                traceback: "Traceback: ...",
              },
            },
          };
        }
      })(),
    });

    await expect(
      evaluators.executeCode({
        projectId: "p1",
        evaluatorId: "e1",
        data: { output: "boom" },
      }),
    ).resolves.toMatchObject({
      status: "error",
      details: "intentional kaboom",
      traceback: ["Traceback: ..."],
    });
  });
  it("keeps nullable lookup and throwing lookup distinct", async () => {
    const missing = repository({
      tryFindById: vi.fn().mockResolvedValue(null),
    });
    const evaluators = service({ repository: missing });

    await expect(
      evaluators.tryGetById({ id: "missing", projectId: "p1" }),
    ).resolves.toBeNull();
    await expect(
      evaluators.getById({ id: "missing", projectId: "p1" }),
    ).rejects.toBeInstanceOf(EvaluatorNotFoundError);
  });

  it("keeps one workflow owned by one evaluator", async () => {
    const evaluators = service({
      repository: repository({
        tryFindByWorkflow: vi
          .fn()
          .mockResolvedValue(
            evaluator({ id: "existing", workflowId: "w1", type: "workflow" }),
          ),
      }),
    });

    await expect(
      evaluators.create({
        id: "e2",
        projectId: "p1",
        name: "Second",
        type: "workflow",
        config: {},
        workflowId: "w1",
      }),
    ).rejects.toBeInstanceOf(EvaluatorWorkflowAlreadyAssignedError);
  });

  it("validates a code evaluator config even when its type is unchanged", async () => {
    const evaluators = service({
      repository: repository({
        tryFindById: vi.fn().mockResolvedValue(evaluator({ type: "code" })),
      }),
    });

    await expect(
      evaluators.update({
        id: "e1",
        projectId: "p1",
        data: { config: { code: "", inputs: [], outputs: [] } },
      }),
    ).rejects.toThrow();
  });

  it("never adds the legacy sticky details output", () => {
    expect(standardEvaluatorOutputFields).toEqual([
      { identifier: "passed", type: "bool" },
      { identifier: "score", type: "float" },
      { identifier: "label", type: "str" },
    ]);
    expect(standardEvaluatorOutputFields).not.toContainEqual(
      expect.objectContaining({ identifier: "details" }),
    );
  });

  it.each([
    {
      evaluatorType: "langevals/exact_match",
      fields: [
        { identifier: "output", type: "str", optional: true },
        { identifier: "expected_output", type: "str", optional: true },
      ],
      outputFields: [{ identifier: "passed", type: "bool" }],
    },
    {
      evaluatorType: "langevals/llm_boolean",
      fields: [
        { identifier: "input", type: "str", optional: true },
        { identifier: "output", type: "str", optional: true },
        { identifier: "contexts", type: "list", optional: true },
      ],
      outputFields: [{ identifier: "passed", type: "bool" }],
    },
    {
      evaluatorType: "ragas/response_relevancy",
      fields: [
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
      ],
      outputFields: [{ identifier: "score", type: "float" }],
    },
    {
      evaluatorType: "presidio/pii_detection",
      fields: [
        { identifier: "input", type: "str", optional: true },
        { identifier: "output", type: "str", optional: true },
      ],
      outputFields: [
        { identifier: "score", type: "float" },
        { identifier: "passed", type: "bool" },
      ],
    },
  ])(
    "derives $evaluatorType fields from the canonical definition",
    async ({ evaluatorType, fields, outputFields }) => {
      const evaluators = service({
        repository: repository({
          tryFindById: vi
            .fn()
            .mockResolvedValue(evaluator({ config: { evaluatorType } })),
        }),
      });

      const result = await evaluators.getByIdWithFields({
        id: "e1",
        projectId: "p1",
      });

      expect(result.fields).toEqual(fields);
      expect(result.outputFields).toEqual(outputFields);
      expect(result.outputFields).not.toContainEqual(
        expect.objectContaining({ identifier: "details" }),
      );
    },
  );

  it("uses empty inputs and standard outputs for an unknown evaluator", async () => {
    const evaluators = service({
      repository: repository({
        tryFindById: vi
          .fn()
          .mockResolvedValue(
            evaluator({ config: { evaluatorType: "unknown/evaluator" } }),
          ),
      }),
    });

    const result = await evaluators.getByIdWithFields({
      id: "e1",
      projectId: "p1",
    });

    expect(result.fields).toEqual([]);
    expect(result.outputFields).toEqual(standardEvaluatorOutputFields);
  });

  it("uses configured code inputs and outputs", async () => {
    const evaluators = service({
      repository: repository({
        tryFindById: vi.fn().mockResolvedValue(
          evaluator({
            type: "code",
            config: {
              code: "def evaluate(): return True",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "passed", type: "bool" }],
            },
          }),
        ),
      }),
    });

    const result = await evaluators.getByIdWithFields({
      id: "e1",
      projectId: "p1",
    });

    expect(result.fields).toEqual([{ identifier: "input", type: "str" }]);
    expect(result.outputFields).toEqual([{ identifier: "passed", type: "bool" }]);
  });

  it("gets workflow fields through the canonical workflow service", async () => {
    const getFields = vi.fn().mockResolvedValue({
      workflowId: "w1",
      workflowName: "Workflow",
      workflowIcon: "sparkles",
      fields: [{ identifier: "input", type: "str" }],
      outputFields: [{ identifier: "result", type: "float" }],
    });
    const evaluators = service({
      repository: repository({
        tryFindById: vi
          .fn()
          .mockResolvedValue(evaluator({ type: "workflow", workflowId: "w1" })),
      }),
      workflows: workflows({ getFields }),
    });

    const result = await evaluators.getByIdWithFields({
      id: "e1",
      projectId: "p1",
    });

    expect(getFields).toHaveBeenCalledWith({
      workflowId: "w1",
      projectId: "p1",
    });
    expect(result.fields).toEqual([{ identifier: "input", type: "str" }]);
    expect(result.outputFields).toEqual([{ identifier: "result", type: "float" }]);
    expect(result.workflowName).toBe("Workflow");
    expect(result.workflowIcon).toBe("sparkles");
  });

  it("falls back to standard outputs when a workflow declares none", async () => {
    const evaluators = service({
      repository: repository({
        tryFindById: vi
          .fn()
          .mockResolvedValue(evaluator({ type: "workflow", workflowId: "w1" })),
      }),
    });

    const result = await evaluators.getByIdWithFields({
      id: "e1",
      projectId: "p1",
    });

    expect(result.fields).toEqual([]);
    expect(result.outputFields).toEqual(standardEvaluatorOutputFields);
  });

  it("enriches every evaluator returned by the repository", async () => {
    const evaluators = service({
      repository: repository({
        findAll: vi.fn().mockResolvedValue([
          evaluator(),
          evaluator({
            id: "e2",
            config: { evaluatorType: "langevals/llm_boolean" },
          }),
        ]),
      }),
    });

    const result = await evaluators.getAllWithFields({ projectId: "p1" });

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.fields.length > 0)).toBe(true);
  });
});
