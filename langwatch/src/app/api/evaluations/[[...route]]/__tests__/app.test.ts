import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../app.v1";

// Mock the evaluation services
vi.mock("~/server/evaluations/service.factory", () => ({
  evaluationService: {
    runEvaluation: vi.fn().mockResolvedValue({
      result: { id: "test-id", status: "success" },
    }),
  },
  batchEvaluationService: {
    logResults: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Mock middleware
vi.mock("../../middleware", () => ({
  authMiddleware: vi.fn((c, next) => {
    c.set("project", { id: "test-project", apiKey: "test-token" });
    return next();
  }),
  handleError: vi.fn(),
}));

vi.mock("../../middleware/logger", () => ({
  loggerMiddleware: vi.fn(() => vi.fn((c, next) => next())),
}));

// Mock the shared schemas
vi.mock("../../shared/base-responses", () => ({
  baseResponses: {},
}));

// Mock the evaluators data
vi.mock("~/server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {
    "test/evaluator": {
      name: "Test Evaluator",
      description: "A test evaluator",
    },
  },
}));

vi.mock("~/server/evaluations/evaluators.zod.generated", () => ({
  evaluatorsSchema: {
    shape: {
      "test/evaluator": {
        shape: {
          settings: {
            parse: vi.fn(),
          },
        },
      },
    },
  },
}));

vi.mock("~/components/checks/EvaluatorSelection", () => ({
  evaluatorTempNameMap: {},
}));

// Mock zodToJsonSchema
vi.mock("zod-to-json-schema", () => ({
  zodToJsonSchema: vi.fn(() => ({})),
}));

// Mock patchZodOpenapi
vi.mock("~/utils/extend-zod-openapi", () => ({
  patchZodOpenapi: vi.fn(),
}));

// Mock the schemas
vi.mock("../schemas/outputs", () => ({
  evaluatorsResponseSchema: { parse: vi.fn() },
  evaluationResultSchema: { parse: vi.fn() },
  batchEvaluationResultSchema: { parse: vi.fn() },
}));

describe("Evaluations API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /", () => {
    it("should return list of evaluators", async () => {
      const req = new Request("http://localhost/api/evaluations/", {
        method: "GET",
        headers: {
          "X-Auth-Token": "test-token",
        },
      });

      const res = await app.request(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("evaluators");
      expect(data.evaluators).toHaveProperty("test/evaluator");
    });
  });

  describe("POST /:evaluator/evaluate", () => {
    it("should handle evaluation request", async () => {
      const req = new Request("http://localhost/api/evaluations/test/evaluator/evaluate", {
        method: "POST",
        headers: {
          "X-Auth-Token": "test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: "test input",
          expected_output: "test output",
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("status");
    });
  });

  describe("POST /batch/log_results", () => {
    it("should handle batch evaluation logging", async () => {
      const req = new Request("http://localhost/api/evaluations/batch/log_results", {
        method: "POST",
        headers: {
          "X-Auth-Token": "test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: ["test input 1", "test input 2"],
          expected_outputs: ["test output 1", "test output 2"],
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("status");
    });
  });

  describe("POST /:evaluator/:subpath/evaluate", () => {
    it("should handle legacy evaluation route", async () => {
      const req = new Request("http://localhost/api/evaluations/test/evaluator/subpath/evaluate", {
        method: "POST",
        headers: {
          "X-Auth-Token": "test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: "test input",
          expected_output: "test output",
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("status");
    });
  });
});
