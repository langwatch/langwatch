import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { createMocks } from "node-mocks-http";

// Mock dependencies
vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    experiment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    BASE_HOST: "https://app.langwatch.ai",
  },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => e instanceof Error ? e : new Error(String(e))),
}));

import { prisma } from "~/server/db";
import handler from "../init";

describe("POST /api/experiment/init", () => {
  const project = {
    id: "project-123",
    slug: "my-project",
    teamId: "team-456",
    apiKey: "test-api-key",
  };

  const existingExperiment = {
    id: "experiment_abc",
    name: "existing-experiment",
    slug: "existing-experiment",
    projectId: "project-123",
    type: "DSPY",
  };

  const createdExperiment = {
    id: "experiment_new",
    name: "new-experiment",
    slug: "new-experiment",
    projectId: "project-123",
    type: "DSPY",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (prisma.project.findUnique as Mock).mockResolvedValue(project);
  });

  function createRequest({
    slug,
    type = "DSPY",
  }: {
    slug: string;
    type?: string;
  }) {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      headers: {
        "x-auth-token": "test-api-key",
      },
      body: {
        experiment_slug: slug,
        experiment_type: type,
      },
    });
    return { req, res };
  }

  describe("when slug already exists", () => {
    beforeEach(() => {
      (prisma.experiment.findFirst as Mock).mockResolvedValue(
        existingExperiment,
      );
    });

    it("returns 200 and resolves the existing experiment path", async () => {
      const { req, res } = createRequest({ slug: "existing-experiment" });
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        path: "/my-project/experiments/existing-experiment",
        slug: "existing-experiment",
      });
    });

    it("does not create a new experiment", async () => {
      const { req, res } = createRequest({ slug: "existing-experiment" });
      await handler(req, res);

      expect(prisma.experiment.create).not.toHaveBeenCalled();
    });
  });

  describe("when slug does not exist", () => {
    beforeEach(() => {
      (prisma.experiment.findFirst as Mock).mockResolvedValue(null);
      (prisma.experiment.create as Mock).mockResolvedValue(createdExperiment);
    });

    it("creates the experiment and returns 200", async () => {
      const { req, res } = createRequest({ slug: "new-experiment" });
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        path: "/my-project/experiments/new-experiment",
        slug: "new-experiment",
      });
    });

    it("creates the experiment via prisma", async () => {
      const { req, res } = createRequest({ slug: "new-experiment" });
      await handler(req, res);

      expect(prisma.experiment.create).toHaveBeenCalledTimes(1);
    });
  });
});
