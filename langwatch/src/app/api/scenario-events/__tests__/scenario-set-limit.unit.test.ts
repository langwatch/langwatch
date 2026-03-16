import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ScenarioSetLimitExceededError } from "~/server/app-layer/usage/errors";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: vi.fn(),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: true,
    BASE_HOST: "https://app.langwatch.ai",
  },
}));

import { getApp } from "~/server/app-layer/app";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import {
  checkScenarioSetLimitForRunStarted,
  type ScenarioSetLimitContext,
} from "../../scenario-events/[[...route]]/scenario-set-limit";

describe("checkScenarioSetLimitForRunStarted()", () => {
  let mockCheckScenarioSetLimit: Mock;
  let mockCtx: ScenarioSetLimitContext;

  const project = {
    id: "project-123",
    teamId: "team-456",
    slug: "test-project",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockCheckScenarioSetLimit = vi.fn().mockResolvedValue(undefined);

    (resolveOrganizationId as Mock).mockResolvedValue("org-789");

    (getApp as Mock).mockReturnValue({
      usage: {
        checkScenarioSetLimit: mockCheckScenarioSetLimit,
      },
    });

    mockCtx = {
      project,
      event: {
        type: ScenarioEventType.RUN_STARTED,
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "my-set",
        timestamp: Date.now(),
      },
    };
  });

  describe("when event type is SCENARIO_RUN_STARTED", () => {
    describe("when scenario set limit is not exceeded", () => {
      it("resolves without error", async () => {
        await expect(
          checkScenarioSetLimitForRunStarted(mockCtx),
        ).resolves.toBeUndefined();
      });

      it("calls checkScenarioSetLimit with resolved organizationId and scenarioSetId", async () => {
        await checkScenarioSetLimitForRunStarted(mockCtx);

        expect(resolveOrganizationId).toHaveBeenCalledWith("project-123");
        expect(mockCheckScenarioSetLimit).toHaveBeenCalledWith({
          organizationId: "org-789",
          scenarioSetId: "my-set",
        });
      });
    });

    describe("when scenario set limit is exceeded", () => {
      it("throws ScenarioSetLimitExceededError", async () => {
        mockCheckScenarioSetLimit.mockRejectedValue(
          new ScenarioSetLimitExceededError(3, 3),
        );

        await expect(
          checkScenarioSetLimitForRunStarted(mockCtx),
        ).rejects.toThrow(ScenarioSetLimitExceededError);
      });
    });

    describe("when scenarioSetId is missing", () => {
      it("skips the limit check", async () => {
        mockCtx.event.scenarioSetId = undefined;

        await expect(
          checkScenarioSetLimitForRunStarted(mockCtx),
        ).resolves.toBeUndefined();

        expect(mockCheckScenarioSetLimit).not.toHaveBeenCalled();
      });
    });

    describe("when organizationId cannot be resolved", () => {
      it("skips the limit check gracefully", async () => {
        (resolveOrganizationId as Mock).mockResolvedValue(undefined);

        await expect(
          checkScenarioSetLimitForRunStarted(mockCtx),
        ).resolves.toBeUndefined();

        expect(mockCheckScenarioSetLimit).not.toHaveBeenCalled();
      });
    });
  });

  describe("when event type is not SCENARIO_RUN_STARTED", () => {
    it("skips the limit check for MESSAGE_SNAPSHOT", async () => {
      mockCtx.event.type = ScenarioEventType.MESSAGE_SNAPSHOT;

      await expect(
        checkScenarioSetLimitForRunStarted(mockCtx),
      ).resolves.toBeUndefined();

      expect(mockCheckScenarioSetLimit).not.toHaveBeenCalled();
      expect(resolveOrganizationId).not.toHaveBeenCalled();
    });

    it("skips the limit check for RUN_FINISHED", async () => {
      mockCtx.event.type = ScenarioEventType.RUN_FINISHED;

      await expect(
        checkScenarioSetLimitForRunStarted(mockCtx),
      ).resolves.toBeUndefined();

      expect(mockCheckScenarioSetLimit).not.toHaveBeenCalled();
    });

    it("skips the limit check for TEXT_MESSAGE_CONTENT", async () => {
      mockCtx.event.type = ScenarioEventType.TEXT_MESSAGE_CONTENT;

      await expect(
        checkScenarioSetLimitForRunStarted(mockCtx),
      ).resolves.toBeUndefined();

      expect(mockCheckScenarioSetLimit).not.toHaveBeenCalled();
    });
  });
});

describe("scenario-events endpoint integration with scenario set limit", () => {
  let mockCheckScenarioSetLimit: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCheckScenarioSetLimit = vi.fn().mockResolvedValue(undefined);

    (resolveOrganizationId as Mock).mockResolvedValue("org-789");

    (getApp as Mock).mockReturnValue({
      usage: {
        checkLimit: vi.fn().mockResolvedValue({ exceeded: false }),
        checkScenarioSetLimit: mockCheckScenarioSetLimit,
      },
      simulations: {
        startRun: vi.fn().mockResolvedValue(undefined),
        messageSnapshot: vi.fn().mockResolvedValue(undefined),
        finishRun: vi.fn().mockResolvedValue(undefined),
      },
      broadcast: {
        broadcastToTenantRateLimited: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  describe("when SCENARIO_RUN_STARTED limit is exceeded", () => {
    it("maps ScenarioSetLimitExceededError to 403 with structured body", () => {
      const error = new ScenarioSetLimitExceededError(3, 3);

      expect(error.httpStatus).toBe(403);
      expect(error.kind).toBe("scenario_set_limit_exceeded");
      expect(error.current).toBe(3);
      expect(error.max).toBe(3);
      expect(error.message).toContain("maximum number of scenario sets");
    });
  });
});
