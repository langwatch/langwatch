import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvaluationService } from "../evaluation.service";
import { PrismaEvaluationRepository } from "../repositories/evaluation.repository";

// Mock dependencies
vi.mock("~/server/db", () => ({
  prisma: {
    monitor: {
      findUnique: vi.fn(),
    },
    cost: {
      create: vi.fn(),
    },
  },
}));

vi.mock("~/server/evaluations/repositories/evaluation.repository", () => ({
  PrismaEvaluationRepository: vi.fn().mockImplementation(() => ({
    findStoredEvaluator: vi.fn().mockResolvedValue(null),
    createCost: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("~/utils/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("~/server/background/queues/evaluationsQueue", () => ({
  updateEvaluationStatusInES: vi.fn(),
}));

vi.mock("~/server/background/workers/evaluationsWorker", () => ({
  runEvaluation: vi.fn(),
}));

vi.mock("~/server/evaluations/utils", () => ({
  getEvaluatorDataForParams: vi.fn(),
  getEvaluatorIncludingCustom: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  default: {
    captureException: vi.fn(),
  },
}));

describe("EvaluationService", () => {
  let evaluationService: EvaluationService;

  beforeEach(() => {
    vi.clearAllMocks();
    const evaluationRepository = new PrismaEvaluationRepository();
    evaluationService = new EvaluationService(evaluationRepository);
  });

  describe("runEvaluation", () => {
    it("should run evaluation successfully", async () => {
      const { getEvaluatorIncludingCustom } = await import("~/server/evaluations/utils");
      (getEvaluatorIncludingCustom as any).mockResolvedValue({
        name: "Test Evaluator",
        requiredFields: ["input"],
      });

      const { getEvaluatorDataForParams } = await import("~/server/evaluations/utils");
      (getEvaluatorDataForParams as any).mockReturnValue({
        data: { input: "test input" },
      });

      const { runEvaluation } = await import("~/server/background/workers/evaluationsWorker");
      (runEvaluation as any).mockResolvedValue({
        status: "processed",
        score: 0.8,
        passed: true,
        details: "Evaluation completed successfully",
      });

      const result = await evaluationService.runEvaluation({
        projectId: "test-project",
        evaluatorSlug: "test/evaluator",
        params: {
          data: { input: "test input" },
          as_guardrail: false,
        },
      });

      expect(result.status).toBe("processed");
      if (result.status === "processed") {
        expect(result.score).toBe(0.8);
        expect(result.passed).toBe(true);
      }
      
      // Verify mocked functions were called
      expect(getEvaluatorIncludingCustom).toHaveBeenCalledWith("test-project", "test/evaluator");
      expect(getEvaluatorDataForParams).toHaveBeenCalledWith("test/evaluator", {
        input: "test input",
      });
      expect(runEvaluation).toHaveBeenCalled();
    });

    it("should throw error for invalid evaluator", async () => {
      const { getEvaluatorIncludingCustom } = await import("~/server/evaluations/utils");
      (getEvaluatorIncludingCustom as any).mockResolvedValue(null);

      const options = {
        projectId: "test-project",
        evaluatorSlug: "invalid/evaluator",
        params: {
          data: { input: "test" },
          as_guardrail: false,
        },
      };

      await expect(evaluationService.runEvaluation(options)).rejects.toThrow(
        "Evaluator not found: invalid/evaluator"
      );
    });

    it("should handle missing required fields", async () => {
      const { getEvaluatorIncludingCustom } = await import("~/server/evaluations/utils");
      (getEvaluatorIncludingCustom as any).mockResolvedValue({
        name: "Test Evaluator",
        requiredFields: ["input"],
      });

      const { getEvaluatorDataForParams } = await import("~/server/evaluations/utils");
      (getEvaluatorDataForParams as any).mockReturnValue({
        data: {}, // Missing required 'input' field
      });

      const options = {
        projectId: "test-project",
        evaluatorSlug: "test/evaluator",
        params: {
          data: {},
          as_guardrail: false,
        },
      };

      await expect(evaluationService.runEvaluation(options)).rejects.toThrow(
        "input is required for Test Evaluator evaluator"
      );
    });

    it("should handle disabled guardrail", async () => {
      const { PrismaEvaluationRepository } = await import("~/server/evaluations/repositories/evaluation.repository");
      const mockRepository = new PrismaEvaluationRepository();
      mockRepository.findStoredEvaluator = vi.fn().mockResolvedValue({
        id: "test-monitor",
        checkType: "test/evaluator",
        enabled: false,
        parameters: {},
      } as any);
      
      const tempService = new EvaluationService(mockRepository);

      const { getEvaluatorIncludingCustom } = await import("~/server/evaluations/utils");
      (getEvaluatorIncludingCustom as any).mockResolvedValue({
        name: "Test Evaluator",
        requiredFields: [],
      });

      const options = {
        projectId: "test-project",
        evaluatorSlug: "test-guardrail",
        params: {
          data: { input: "test" },
          as_guardrail: true,
        },
        asGuardrail: true,
      };

      const { runEvaluation } = await import("~/server/background/workers/evaluationsWorker");
      
      const result = await tempService.runEvaluation(options);
      expect(result.status).toBe("skipped");
      expect(result.details).toBe("Guardrail is not enabled");
      // For skipped results, passed property doesn't exist, so we don't test it
      
      // Verify that evaluation was not executed
      expect(runEvaluation).not.toHaveBeenCalled();
    });
  });
});
