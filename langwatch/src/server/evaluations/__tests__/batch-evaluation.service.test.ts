import { describe, it, expect, vi, beforeEach } from "vitest";
import { BatchEvaluationService } from "../batch-evaluation.service";
import { ElasticsearchBatchEvaluationRepository } from "../repositories/batch-evaluation.repository";
import { PrismaExperimentRepository } from "../repositories/experiment.repository";

// Mock dependencies
vi.mock("~/server/db", () => ({
  prisma: {
    experiment: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("~/utils/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("~/server/experiments/types", () => ({
  ESBatchEvaluation: vi.fn(),
}));

vi.mock("~/server/experiments/types.generated", () => ({
  eSBatchEvaluationRESTParamsSchema: {
    parse: vi.fn(),
  },
}));

vi.mock("~/server/evaluations/repositories/experiment.repository", () => ({
  PrismaExperimentRepository: vi.fn().mockImplementation(() => ({
    findOrCreateExperiment: vi.fn().mockResolvedValue({
      id: "experiment-123",
      slug: "test-experiment",
      name: "Test Experiment",
      type: "BATCH_EVALUATION",
    }),
  })),
}));

vi.mock("~/server/evaluations/repositories/batch-evaluation.repository", () => ({
  ElasticsearchBatchEvaluationRepository: vi.fn().mockImplementation(() => ({
    findOrCreateExperiment: vi.fn().mockResolvedValue({
      id: "experiment-123",
      slug: "test-experiment",
      name: "Test Experiment",
      type: "BATCH_EVALUATION",
    }),
    storeBatchEvaluation: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("~/server/elasticsearch", () => ({
  esClient: vi.fn(() => Promise.resolve({
    index: vi.fn().mockResolvedValue({}),
  })),
  BATCH_EVALUATION_INDEX: { alias: "batch_evaluations" },
  batchEvaluationId: vi.fn(({ projectId, experimentId, runId }) => `${projectId}/${experimentId}/${runId}`),
}));

vi.mock("~/server/metrics", () => ({
  getPayloadSizeHistogram: vi.fn(() => ({
    observe: vi.fn(),
  })),
}));

vi.mock("zod-validation-error", () => ({
  fromZodError: vi.fn((error) => ({
    message: error.message || "Validation failed",
  })),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("BatchEvaluationService", () => {
  let batchEvaluationService: BatchEvaluationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    const experimentRepository = new PrismaExperimentRepository();
    const batchEvaluationRepository = new ElasticsearchBatchEvaluationRepository(experimentRepository);
    batchEvaluationService = new BatchEvaluationService(batchEvaluationRepository);
  });

  describe("logResults", () => {
    it("should log batch evaluation results successfully", async () => {
      const { eSBatchEvaluationRESTParamsSchema } = await import("~/server/experiments/types.generated");
      (eSBatchEvaluationRESTParamsSchema.parse as any).mockReturnValue({
        run_id: "test-run",
        experiment_id: "test-experiment",
        project_id: "test-project",
        evaluator_id: "test-evaluator",
        results: [{ score: 0.8, passed: true }],
      });

      // Repository mocks are set up in beforeEach

      const result = await batchEvaluationService.logResults({
        projectId: "test-project",
        params: {
          run_id: "test-run",
          experiment_id: "test-experiment",
          project_id: "test-project",
          evaluator_id: "test-evaluator",
          results: [{ score: 0.8, passed: true }],
        },
      });

      expect(result.success).toBe(true);
    });

    it("should throw error for missing experiment_id and experiment_slug", async () => {
      const { eSBatchEvaluationRESTParamsSchema } = await import("~/server/experiments/types.generated");
      (eSBatchEvaluationRESTParamsSchema.parse as any).mockReturnValue({
        run_id: "test-run",
        project_id: "test-project",
        evaluator_id: "test-evaluator",
        // Missing both experiment_id and experiment_slug
      });

      await expect(
        batchEvaluationService.logResults({
          projectId: "test-project",
          params: {
            run_id: "test-run",
            project_id: "test-project",
            evaluator_id: "test-evaluator",
            // Missing both experiment_id and experiment_slug
          },
        })
      ).rejects.toThrow("Either experiment_id or experiment_slug is required");
    });



    it("should handle validation errors", async () => {
      const { eSBatchEvaluationRESTParamsSchema } = await import("~/server/experiments/types.generated");
      (eSBatchEvaluationRESTParamsSchema.parse as any).mockImplementation(() => {
       (eSBatchEvaluationRESTParamsSchema.parse as any).mockImplementation(() => {
         const error = new Error("Validation failed");
         error.name = "ZodError";
         error.issues = [{ 
           code: "custom",
           message: "Validation failed",
           path: ["params"]
         }];
         throw error;
       });
      });

      const options = {
        projectId: "test-project",
        params: {
          invalid: "data",
        },
      };

      await expect(batchEvaluationService.logResults(options)).rejects.toThrow(
        "Validation failed"
      );
    });

    it("should handle Elasticsearch errors", async () => {
      const { eSBatchEvaluationRESTParamsSchema } = await import("~/server/experiments/types.generated");
      (eSBatchEvaluationRESTParamsSchema.parse as any).mockReturnValue({
        experiment_id: "test-experiment",
        project_id: "test-project",
        evaluator_id: "test-evaluator",
        results: [],
      });

      // Mock the repository to throw an error
      const { ElasticsearchBatchEvaluationRepository } = await import("~/server/evaluations/repositories/batch-evaluation.repository");
      const mockRepository = new ElasticsearchBatchEvaluationRepository();
      mockRepository.storeBatchEvaluation = vi.fn().mockRejectedValue(new Error("Failed to store batch evaluation results"));
      
      const tempService = new BatchEvaluationService(mockRepository);

      const options = {
        projectId: "test-project",
        params: {
          experiment_id: "test-experiment",
          project_id: "test-project",
          evaluator_id: "test-evaluator",
          results: [],
        },
      };

      await expect(tempService.logResults(options)).rejects.toThrow(
        "Failed to store batch evaluation results"
      );
    });
  });
});
