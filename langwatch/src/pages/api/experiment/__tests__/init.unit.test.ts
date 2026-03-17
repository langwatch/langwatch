import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { LimitExceededError } from "~/server/license-enforcement/errors";

// Mock dependencies
vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    experiment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/server/license-enforcement", () => ({
  createLicenseEnforcementService: vi.fn(),
}));

vi.mock("~/server/license-enforcement/limit-message", () => ({
  buildResourceLimitMessage: vi.fn(),
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
}));

import { prisma } from "~/server/db";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { buildResourceLimitMessage } from "~/server/license-enforcement/limit-message";
import handler from "../init";

describe("POST /api/experiment/init", () => {
  let mockEnforceLimit: Mock;

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

    (prisma.team.findUnique as Mock).mockResolvedValue({
      id: "team-456",
      organizationId: "org-789",
    });

    mockEnforceLimit = vi.fn().mockResolvedValue(undefined);
    (createLicenseEnforcementService as Mock).mockReturnValue({
      enforceLimit: mockEnforceLimit,
    });

    (buildResourceLimitMessage as Mock).mockResolvedValue(
      "Free plan limit of 3 experiments reached. To increase your limits, upgrade your plan at https://app.langwatch.ai/settings/subscription",
    );
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
      (prisma.experiment.findUnique as Mock).mockResolvedValue(
        existingExperiment,
      );
    });

    it("returns 200 regardless of limit status", async () => {
      mockEnforceLimit.mockRejectedValue(
        new LimitExceededError("experiments", 3, 3),
      );

      const { req, res } = createRequest({ slug: "existing-experiment" });
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        path: "/my-project/experiments/existing-experiment",
        slug: "existing-experiment",
      });
    });

    it("does not call enforceLimit", async () => {
      const { req, res } = createRequest({ slug: "existing-experiment" });
      await handler(req, res);

      expect(mockEnforceLimit).not.toHaveBeenCalled();
    });
  });

  describe("when slug does not exist", () => {
    beforeEach(() => {
      (prisma.experiment.findUnique as Mock).mockResolvedValue(null);
      (prisma.experiment.create as Mock).mockResolvedValue(createdExperiment);
    });

    describe("when org is under experiment limit", () => {
      it("creates the experiment and returns 200", async () => {
        const { req, res } = createRequest({ slug: "new-experiment" });
        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res._getJSONData()).toEqual({
          path: "/my-project/experiments/new-experiment",
          slug: "new-experiment",
        });
      });

      it("calls enforceLimit with the resolved organizationId", async () => {
        const { req, res } = createRequest({ slug: "new-experiment" });
        await handler(req, res);

        expect(prisma.team.findUnique).toHaveBeenCalledWith({
          where: { id: "team-456" },
          select: { organizationId: true },
        });
        expect(mockEnforceLimit).toHaveBeenCalledWith(
          "org-789",
          "experiments",
        );
      });
    });

    describe("when org is at experiment limit", () => {
      beforeEach(() => {
        mockEnforceLimit.mockRejectedValue(
          new LimitExceededError("experiments", 3, 3),
        );
      });

      it("returns 403 with structured error response", async () => {
        const { req, res } = createRequest({ slug: "new-experiment" });
        await handler(req, res);

        expect(res.statusCode).toBe(403);
        const body = res._getJSONData();
        expect(body).toEqual({
          error: "resource_limit_exceeded",
          message: expect.stringContaining("experiments reached"),
          limitType: "experiments",
          current: 3,
          max: 3,
        });
      });

      it("includes a customer-facing upgrade message", async () => {
        const { req, res } = createRequest({ slug: "new-experiment" });
        await handler(req, res);

        const body = res._getJSONData();
        expect(body.message).toContain(
          "Free plan limit of 3 experiments reached",
        );
        expect(body.message).toContain("upgrade your plan");
      });

      it("does not create the experiment", async () => {
        const { req, res } = createRequest({ slug: "new-experiment" });
        await handler(req, res);

        expect(prisma.experiment.create).not.toHaveBeenCalled();
      });
    });
  });
});
