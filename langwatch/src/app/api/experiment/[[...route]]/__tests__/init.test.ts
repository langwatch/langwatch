import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../app";
import { PrismaExperimentService } from "~/server/experiments";

// Mock the database
vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn().mockResolvedValue({
        id: "test-project",
        apiKey: "test-token",
        slug: "test-project",
        organization: {
          id: "test-org",
          elasticsearchUrl: "http://localhost:9200",
          elasticsearchApiKey: "test-es-key",
        },
      }),
    },
    experiment: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "experiment_123",
        slug: "test-experiment",
        name: "Test Experiment",
        type: "DSPY",
      }),
    },
  },
}));

// Mock middleware
vi.mock("../../middleware", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("project", { 
      id: "test-project", 
      apiKey: "test-token",
      slug: "test-project",
      organization: {
        id: "test-org",
        elasticsearchUrl: "http://localhost:9200",
        elasticsearchApiKey: "test-es-key",
      },
    });
    return next();
  }),
  handleError: vi.fn(),
}));

vi.mock("../../middleware/logger", () => ({
  loggerMiddleware: vi.fn(() => vi.fn((c, next) => next())),
}));

// Mock the experiment service
vi.mock("~/server/experiments", () => ({
  PrismaExperimentService: vi.fn().mockImplementation(() => ({
    findOrCreateExperiment: vi.fn().mockResolvedValue({
      id: "experiment_123",
      slug: "test-experiment",
      name: "Test Experiment",
      type: "DSPY",
    }),
  })),
  PrismaExperimentRepository: vi.fn(),
}));

describe("POST /init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize experiment with valid data", async () => {
    // Create a mock request
    const req = new Request("http://localhost/api/experiment/init", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": "test-token",
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
        "X-Auth-Token": "test-token",
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
        "X-Auth-Token": "test-token",
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
