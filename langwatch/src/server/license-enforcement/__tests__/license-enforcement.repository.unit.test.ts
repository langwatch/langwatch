import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrganizationUserRole, type PrismaClient } from "@prisma/client";
import { LicenseEnforcementRepository } from "../license-enforcement.repository";

/**
 * Unit tests for LicenseEnforcementRepository.
 *
 * Tests the data access layer with mocked Prisma:
 * - Verifies correct where clauses for each method
 * - Confirms archivedAt: null filtering for workflows/evaluators
 * - Validates query structure for all 8 Prisma-based methods
 *
 * Note: Message/trace counting is NOT tested here because it uses
 * Elasticsearch via TraceUsageService, not Prisma. That's tested
 * in the UsageStatsService tests.
 */

// Create mock Prisma client
const createMockPrisma = () => ({
  workflow: {
    count: vi.fn().mockResolvedValue(0),
  },
  llmPromptConfig: {
    count: vi.fn().mockResolvedValue(0),
  },
  evaluator: {
    count: vi.fn().mockResolvedValue(0),
  },
  scenario: {
    count: vi.fn().mockResolvedValue(0),
  },
  project: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
  organizationUser: {
    count: vi.fn().mockResolvedValue(0),
  },
  agent: {
    count: vi.fn().mockResolvedValue(0),
  },
  batchEvaluation: {
    count: vi.fn().mockResolvedValue(0),
  },
  cost: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
  },
});

type MockPrisma = ReturnType<typeof createMockPrisma>;

describe("LicenseEnforcementRepository", () => {
  let repository: LicenseEnforcementRepository;
  let mockPrisma: MockPrisma;
  const organizationId = "org-123";

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    repository = new LicenseEnforcementRepository(
      mockPrisma as unknown as PrismaClient,
    );
  });

  describe("getWorkflowCount", () => {
    it("queries workflows with organization filter and archivedAt null", async () => {
      mockPrisma.workflow.count.mockResolvedValue(5);

      const result = await repository.getWorkflowCount(organizationId);

      expect(mockPrisma.workflow.count).toHaveBeenCalledWith({
        where: {
          project: { team: { organizationId } },
          archivedAt: null,
        },
      });
      expect(result).toBe(5);
    });

    it("returns zero when no workflows exist", async () => {
      mockPrisma.workflow.count.mockResolvedValue(0);

      const result = await repository.getWorkflowCount(organizationId);

      expect(result).toBe(0);
    });
  });

  describe("getPromptCount", () => {
    it("queries prompts with organization filter (no archive filter)", async () => {
      mockPrisma.llmPromptConfig.count.mockResolvedValue(10);

      const result = await repository.getPromptCount(organizationId);

      expect(mockPrisma.llmPromptConfig.count).toHaveBeenCalledWith({
        where: { project: { team: { organizationId } } },
      });
      expect(result).toBe(10);
    });

    it("returns zero when no prompts exist", async () => {
      mockPrisma.llmPromptConfig.count.mockResolvedValue(0);

      const result = await repository.getPromptCount(organizationId);

      expect(result).toBe(0);
    });
  });

  describe("getEvaluatorCount", () => {
    it("queries evaluators with organization filter and archivedAt null", async () => {
      mockPrisma.evaluator.count.mockResolvedValue(3);

      const result = await repository.getEvaluatorCount(organizationId);

      expect(mockPrisma.evaluator.count).toHaveBeenCalledWith({
        where: {
          project: { team: { organizationId } },
          archivedAt: null,
        },
      });
      expect(result).toBe(3);
    });

    it("returns zero when no evaluators exist", async () => {
      mockPrisma.evaluator.count.mockResolvedValue(0);

      const result = await repository.getEvaluatorCount(organizationId);

      expect(result).toBe(0);
    });
  });

  describe("getScenarioCount", () => {
    it("queries scenarios with organization filter (no archive filter)", async () => {
      mockPrisma.scenario.count.mockResolvedValue(7);

      const result = await repository.getScenarioCount(organizationId);

      expect(mockPrisma.scenario.count).toHaveBeenCalledWith({
        where: { project: { team: { organizationId } } },
      });
      expect(result).toBe(7);
    });

    it("returns zero when no scenarios exist", async () => {
      mockPrisma.scenario.count.mockResolvedValue(0);

      const result = await repository.getScenarioCount(organizationId);

      expect(result).toBe(0);
    });
  });

  describe("getProjectCount", () => {
    it("queries projects with organization filter", async () => {
      mockPrisma.project.count.mockResolvedValue(4);

      const result = await repository.getProjectCount(organizationId);

      expect(mockPrisma.project.count).toHaveBeenCalledWith({
        where: { team: { organizationId } },
      });
      expect(result).toBe(4);
    });

    it("returns zero when no projects exist", async () => {
      mockPrisma.project.count.mockResolvedValue(0);

      const result = await repository.getProjectCount(organizationId);

      expect(result).toBe(0);
    });
  });

  describe("getMemberCount", () => {
    it("queries organization users excluding Member Lite (EXTERNAL) role", async () => {
      mockPrisma.organizationUser.count.mockResolvedValue(8);

      const result = await repository.getMemberCount(organizationId);

      expect(mockPrisma.organizationUser.count).toHaveBeenCalledWith({
        where: { organizationId, role: { not: OrganizationUserRole.EXTERNAL } },
      });
      expect(result).toBe(8);
    });

    it("returns zero when no members exist", async () => {
      mockPrisma.organizationUser.count.mockResolvedValue(0);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });
  });

  describe("getMembersLiteCount", () => {
    it("queries organization users with Member Lite (EXTERNAL) role filter", async () => {
      mockPrisma.organizationUser.count.mockResolvedValue(2);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(mockPrisma.organizationUser.count).toHaveBeenCalledWith({
        where: { organizationId, role: OrganizationUserRole.EXTERNAL },
      });
      expect(result).toBe(2);
    });

    it("returns zero when no Member Lite users exist", async () => {
      mockPrisma.organizationUser.count.mockResolvedValue(0);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });
  });

  describe("getAgentCount", () => {
    it("fetches project IDs then counts agents with projectId filter", async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: "proj-1" },
        { id: "proj-2" },
      ]);
      mockPrisma.agent.count.mockResolvedValue(7);

      const result = await repository.getAgentCount(organizationId);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith({
        where: { team: { organizationId } },
        select: { id: true },
      });
      expect(mockPrisma.agent.count).toHaveBeenCalledWith({
        where: {
          projectId: { in: ["proj-1", "proj-2"] },
          archivedAt: null,
        },
      });
      expect(result).toBe(7);
    });

    it("returns zero when no projects exist (skips agent count)", async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      const result = await repository.getAgentCount(organizationId);

      expect(mockPrisma.agent.count).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });

    it("returns zero when no agents exist", async () => {
      mockPrisma.project.findMany.mockResolvedValue([{ id: "proj-1" }]);
      mockPrisma.agent.count.mockResolvedValue(0);

      const result = await repository.getAgentCount(organizationId);

      expect(result).toBe(0);
    });
  });

  describe("getEvaluationsCreditUsed", () => {
    it("queries batch evaluations with date filter for current month", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));

      mockPrisma.batchEvaluation.count.mockResolvedValue(50);

      const result = await repository.getEvaluationsCreditUsed(organizationId);

      expect(mockPrisma.batchEvaluation.count).toHaveBeenCalledWith({
        where: {
          project: { team: { organizationId } },
          createdAt: { gte: expect.any(Date) },
        },
      });
      expect(result).toBe(50);

      vi.useRealTimers();
    });

    it("returns zero when no evaluations this month", async () => {
      mockPrisma.batchEvaluation.count.mockResolvedValue(0);

      const result = await repository.getEvaluationsCreditUsed(organizationId);

      expect(result).toBe(0);
    });

    it("uses start of current month for date filter", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-03-20T15:30:00.000Z"));

      await repository.getEvaluationsCreditUsed(organizationId);

      const call = mockPrisma.batchEvaluation.count.mock.calls[0]?.[0];
      const dateFilter = call?.where?.createdAt?.gte as Date;

      // Should be start of March 2024
      expect(dateFilter.getFullYear()).toBe(2024);
      expect(dateFilter.getMonth()).toBe(2); // March (0-indexed)
      expect(dateFilter.getDate()).toBe(1);

      vi.useRealTimers();
    });
  });

  describe("query structure validation", () => {
    it("workflow query excludes archived workflows", async () => {
      await repository.getWorkflowCount(organizationId);

      const call = mockPrisma.workflow.count.mock.calls[0]?.[0];
      expect(call?.where).toHaveProperty("archivedAt", null);
    });

    it("evaluator query excludes archived evaluators", async () => {
      await repository.getEvaluatorCount(organizationId);

      const call = mockPrisma.evaluator.count.mock.calls[0]?.[0];
      expect(call?.where).toHaveProperty("archivedAt", null);
    });

    it("prompt query does not have archivedAt filter", async () => {
      await repository.getPromptCount(organizationId);

      const call = mockPrisma.llmPromptConfig.count.mock.calls[0]?.[0];
      expect(call?.where).not.toHaveProperty("archivedAt");
    });

    it("scenario query does not have archivedAt filter", async () => {
      await repository.getScenarioCount(organizationId);

      const call = mockPrisma.scenario.count.mock.calls[0]?.[0];
      expect(call?.where).not.toHaveProperty("archivedAt");
    });

    it("agent query excludes archived agents", async () => {
      mockPrisma.project.findMany.mockResolvedValue([{ id: "proj-1" }]);
      await repository.getAgentCount(organizationId);

      const call = mockPrisma.agent.count.mock.calls[0]?.[0];
      expect(call?.where).toHaveProperty("archivedAt", null);
    });
  });

  describe("getCurrentMonthCost", () => {
    it("fetches project IDs and aggregates cost for current month", async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: "proj-1" },
        { id: "proj-2" },
      ]);
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: 150.5 } });

      const result = await repository.getCurrentMonthCost(organizationId);

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith({
        where: { team: { organizationId } },
        select: { id: true },
      });
      expect(mockPrisma.cost.aggregate).toHaveBeenCalledWith({
        where: {
          projectId: { in: ["proj-1", "proj-2"] },
          createdAt: { gte: expect.any(Date) },
        },
        _sum: { amount: true },
      });
      expect(result).toBe(150.5);
    });

    it("returns zero when no cost data exists", async () => {
      mockPrisma.project.findMany.mockResolvedValue([{ id: "proj-1" }]);
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: null } });

      const result = await repository.getCurrentMonthCost(organizationId);

      expect(result).toBe(0);
    });

    it("returns zero when no projects exist", async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      const result = await repository.getCurrentMonthCost(organizationId);

      // Should still call aggregate with empty array
      expect(mockPrisma.cost.aggregate).toHaveBeenCalledWith({
        where: {
          projectId: { in: [] },
          createdAt: { gte: expect.any(Date) },
        },
        _sum: { amount: true },
      });
      expect(result).toBe(0);
    });

    it("uses start of current month for date filter", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-03-20T15:30:00.000Z"));
      mockPrisma.project.findMany.mockResolvedValue([{ id: "proj-1" }]);
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: 100 } });

      await repository.getCurrentMonthCost(organizationId);

      const call = mockPrisma.cost.aggregate.mock.calls[0]?.[0];
      const dateFilter = call?.where?.createdAt?.gte as Date;

      expect(dateFilter.getFullYear()).toBe(2024);
      expect(dateFilter.getMonth()).toBe(2); // March (0-indexed)
      expect(dateFilter.getDate()).toBe(1);

      vi.useRealTimers();
    });
  });

  describe("getCurrentMonthCostForProjects", () => {
    it("aggregates cost for specified project IDs", async () => {
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: 75.25 } });
      const projectIds = ["proj-a", "proj-b", "proj-c"];

      const result =
        await repository.getCurrentMonthCostForProjects(projectIds);

      expect(mockPrisma.cost.aggregate).toHaveBeenCalledWith({
        where: {
          projectId: { in: projectIds },
          createdAt: { gte: expect.any(Date) },
        },
        _sum: { amount: true },
      });
      expect(result).toBe(75.25);
    });

    it("returns zero when amount is null", async () => {
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: null } });

      const result = await repository.getCurrentMonthCostForProjects([
        "proj-1",
      ]);

      expect(result).toBe(0);
    });

    it("handles empty project array", async () => {
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: null } });

      const result = await repository.getCurrentMonthCostForProjects([]);

      expect(mockPrisma.cost.aggregate).toHaveBeenCalledWith({
        where: {
          projectId: { in: [] },
          createdAt: { gte: expect.any(Date) },
        },
        _sum: { amount: true },
      });
      expect(result).toBe(0);
    });
  });
});
