/**
 * Unit tests for EvaluatorService field computation logic.
 *
 * Tests the service layer's ability to compute fields for:
 * - Built-in evaluators (from AVAILABLE_EVALUATORS)
 * - Workflow evaluators (from workflow DSL)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Evaluator, PrismaClient } from "@prisma/client";
import { EvaluatorService, type EvaluatorField } from "../evaluator.service";
import type { EvaluatorRepository } from "../evaluator.repository";

// Mock AVAILABLE_EVALUATORS
vi.mock("~/server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {
    "langevals/exact_match": {
      name: "Exact Match",
      requiredFields: ["output", "expected_output"],
      optionalFields: [],
    },
    "langevals/llm_boolean": {
      name: "LLM Boolean",
      requiredFields: [],
      optionalFields: ["input", "output", "contexts"],
    },
    "legacy/ragas_answer_relevancy": {
      name: "Answer Relevancy",
      requiredFields: ["input", "output"],
      optionalFields: ["contexts", "expected_contexts"],
    },
    "presidio/pii_detection": {
      name: "PII Detection",
      requiredFields: ["input"],
      optionalFields: ["conversation"],
    },
  },
}));

describe("EvaluatorService", () => {
  describe("field computation for built-in evaluators", () => {
    it("computes required fields correctly", async () => {
      const mockPrisma = {} as PrismaClient;
      const mockRepository = {
        findById: vi.fn().mockResolvedValue({
          id: "eval-1",
          type: "evaluator",
          config: { evaluatorType: "langevals/exact_match" },
        } as unknown as Evaluator),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "eval-1",
        projectId: "proj-1",
      });

      expect(result).not.toBeNull();
      expect(result!.fields).toEqual([
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
      ]);
    });

    it("computes optional fields with optional flag", async () => {
      const mockPrisma = {} as PrismaClient;
      const mockRepository = {
        findById: vi.fn().mockResolvedValue({
          id: "eval-2",
          type: "evaluator",
          config: { evaluatorType: "langevals/llm_boolean" },
        } as unknown as Evaluator),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "eval-2",
        projectId: "proj-1",
      });

      expect(result).not.toBeNull();
      expect(result!.fields).toEqual([
        { identifier: "input", type: "str", optional: true },
        { identifier: "output", type: "str", optional: true },
        { identifier: "contexts", type: "list", optional: true },
      ]);
    });

    it("maps contexts and expected_contexts to list type", async () => {
      const mockPrisma = {} as PrismaClient;
      const mockRepository = {
        findById: vi.fn().mockResolvedValue({
          id: "eval-3",
          type: "evaluator",
          config: { evaluatorType: "legacy/ragas_answer_relevancy" },
        } as unknown as Evaluator),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "eval-3",
        projectId: "proj-1",
      });

      expect(result).not.toBeNull();
      expect(result!.fields).toEqual([
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
        { identifier: "contexts", type: "list", optional: true },
        { identifier: "expected_contexts", type: "list", optional: true },
      ]);
    });

    it("maps conversation to list type", async () => {
      const mockPrisma = {} as PrismaClient;
      const mockRepository = {
        findById: vi.fn().mockResolvedValue({
          id: "eval-4",
          type: "evaluator",
          config: { evaluatorType: "presidio/pii_detection" },
        } as unknown as Evaluator),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "eval-4",
        projectId: "proj-1",
      });

      expect(result).not.toBeNull();
      expect(result!.fields).toContainEqual({
        identifier: "conversation",
        type: "list",
        optional: true,
      });
    });

    it("returns empty fields for unknown evaluator type", async () => {
      const mockPrisma = {} as PrismaClient;
      const mockRepository = {
        findById: vi.fn().mockResolvedValue({
          id: "eval-5",
          type: "evaluator",
          config: { evaluatorType: "unknown/evaluator" },
        } as unknown as Evaluator),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "eval-5",
        projectId: "proj-1",
      });

      expect(result).not.toBeNull();
      expect(result!.fields).toEqual([]);
    });

    it("returns null for non-existent evaluator", async () => {
      const mockPrisma = {} as PrismaClient;
      const mockRepository = {
        findById: vi.fn().mockResolvedValue(null),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "non-existent",
        projectId: "proj-1",
      });

      expect(result).toBeNull();
    });
  });

  describe("field computation for workflow evaluators", () => {
    it("computes fields from workflow entry node outputs", async () => {
      const mockPrisma = {
        workflow: {
          findUnique: vi.fn().mockResolvedValue({
            id: "wf-1",
            currentVersion: {
              dsl: {
                nodes: [
                  {
                    id: "entry",
                    type: "entry",
                    data: {
                      outputs: [
                        { identifier: "question", type: "str" },
                        { identifier: "context", type: "str" },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        },
      } as unknown as PrismaClient;

      const mockRepository = {
        findById: vi.fn().mockResolvedValue({
          id: "eval-wf",
          type: "workflow",
          workflowId: "wf-1",
          config: {},
        } as unknown as Evaluator),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "eval-wf",
        projectId: "proj-1",
      });

      expect(result).not.toBeNull();
      // Workflow fields are all required (no optional flag)
      expect(result!.fields).toEqual([
        { identifier: "question", type: "str" },
        { identifier: "context", type: "str" },
      ]);
    });

    it("returns empty fields for workflow without DSL", async () => {
      const mockPrisma = {
        workflow: {
          findUnique: vi.fn().mockResolvedValue({
            id: "wf-2",
            currentVersion: null,
          }),
        },
      } as unknown as PrismaClient;

      const mockRepository = {
        findById: vi.fn().mockResolvedValue({
          id: "eval-wf-2",
          type: "workflow",
          workflowId: "wf-2",
          config: {},
        } as unknown as Evaluator),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "eval-wf-2",
        projectId: "proj-1",
      });

      expect(result).not.toBeNull();
      expect(result!.fields).toEqual([]);
    });

    it("returns empty fields for non-existent workflow", async () => {
      const mockPrisma = {
        workflow: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;

      const mockRepository = {
        findById: vi.fn().mockResolvedValue({
          id: "eval-wf-3",
          type: "workflow",
          workflowId: "non-existent-wf",
          config: {},
        } as unknown as Evaluator),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const result = await service.getByIdWithFields({
        id: "eval-wf-3",
        projectId: "proj-1",
      });

      expect(result).not.toBeNull();
      expect(result!.fields).toEqual([]);
    });
  });

  describe("getAllWithFields", () => {
    it("enriches all evaluators with fields", async () => {
      const mockPrisma = {} as PrismaClient;
      const mockRepository = {
        findAll: vi.fn().mockResolvedValue([
          {
            id: "eval-1",
            type: "evaluator",
            config: { evaluatorType: "langevals/exact_match" },
          },
          {
            id: "eval-2",
            type: "evaluator",
            config: { evaluatorType: "langevals/llm_boolean" },
          },
        ] as unknown as Evaluator[]),
      } as unknown as EvaluatorRepository;

      const service = new EvaluatorService(mockPrisma, mockRepository);
      const results = await service.getAllWithFields({ projectId: "proj-1" });

      expect(results).toHaveLength(2);
      expect(results[0]!.fields).toEqual([
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
      ]);
      expect(results[1]!.fields).toEqual([
        { identifier: "input", type: "str", optional: true },
        { identifier: "output", type: "str", optional: true },
        { identifier: "contexts", type: "list", optional: true },
      ]);
    });
  });
});
