import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../app.v1";
import { PrismaExperimentService } from "~/server/experiments";

// Mock the experiment service
vi.mock("~/server/experiments", () => ({
  PrismaExperimentService: vi.fn(),
}));

describe("POST /init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize experiment with valid data", async () => {
    const mockExperiment = {
      id: "experiment_123",
      slug: "test-experiment",
      name: "Test Experiment",
      projectId: "project_123",
      type: "DSPY" as const,
      workflowId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockService = {
      findOrCreateExperiment: vi.fn().mockResolvedValue(mockExperiment),
    };

    // Mock the middleware to inject our mock service
    const mockContext = {
      get: vi.fn((key: string) => {
        if (key === "experimentService") return mockService;
        if (key === "project") return { id: "project_123", slug: "test-project" };
        return null;
      }),
      req: {
        valid: vi.fn(() => ({
          experiment_slug: "test-experiment",
          experiment_type: "DSPY",
          experiment_name: "Test Experiment",
        })),
      },
      json: vi.fn(),
    };

    // Create a mock request
    const req = new Request("http://localhost/api/experiment/init", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        experiment_slug: "test-experiment",
        experiment_type: "DSPY",
        experiment_name: "Test Experiment",
      }),
    });

    // Test the endpoint
    const res = await app.request(req);
    
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data).toEqual({
      path: "/test-project/experiments/test-experiment",
      slug: "test-experiment",
    });
  });

  it("should return 400 when neither experiment_id nor experiment_slug is provided", async () => {
    const req = new Request("http://localhost/api/experiment/init", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        experiment_type: "DSPY",
      }),
    });

    const res = await app.request(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 for invalid experiment_type", async () => {
    const req = new Request("http://localhost/api/experiment/init", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        experiment_slug: "test-experiment",
        experiment_type: "INVALID_TYPE",
      }),
    });

    const res = await app.request(req);
    expect(res.status).toBe(400);
  });
});
