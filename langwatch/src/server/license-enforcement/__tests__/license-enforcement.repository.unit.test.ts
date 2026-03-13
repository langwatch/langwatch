import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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
 *
 * Note: Classification function tests (isViewOnlyPermission, isViewOnlyCustomRole,
 * classifyMemberType, isFullMember, isLiteMember) are in member-classification.unit.test.ts
 *
 * Terminology: The EXTERNAL enum value corresponds to "Lite Member" in user-facing text.
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
    findMany: vi.fn().mockResolvedValue([]),
  },
  organizationInvite: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  team: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  teamUser: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  customRole: {
    findMany: vi.fn().mockResolvedValue([]),
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

  describe("getActiveScenarioCount", () => {
    it("queries only active (non-archived) scenarios with organization filter", async () => {
      mockPrisma.scenario.count.mockResolvedValue(7);

      const result = await repository.getActiveScenarioCount(organizationId);

      expect(mockPrisma.scenario.count).toHaveBeenCalledWith({
        where: { project: { team: { organizationId } }, archivedAt: null },
      });
      expect(result).toBe(7);
    });

    it("returns zero when no scenarios exist", async () => {
      mockPrisma.scenario.count.mockResolvedValue(0);

      const result = await repository.getActiveScenarioCount(organizationId);

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
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-03-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts ADMIN and MEMBER role users as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.ADMIN },
        { userId: "u2", role: OrganizationUserRole.MEMBER },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(2);
    });

    it("counts EXTERNAL role users with non-view custom role as full members (elevated from Lite Member)", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.teamUser.findMany.mockResolvedValue([
        { userId: "u1", assignedRoleId: "role-1" },
      ]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "project:manage"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(1);
    });

    it("does not count EXTERNAL role users with view-only custom role as full members (they are Lite Member)", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.teamUser.findMany.mockResolvedValue([
        { userId: "u1", assignedRoleId: "role-1" },
      ]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "analytics:view"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });

    it("counts pending invites with ADMIN role as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.ADMIN,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(1);
    });

    it("counts pending invites with MEMBER role as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.MEMBER,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(1);
    });

    it("counts pending invites with non-view custom role as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "project:update"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: [{ teamId: "team-1", customRoleId: "role-1" }],
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(1);
    });

    it("does not count pending invites with view-only custom role as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "analytics:view"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: [{ teamId: "team-1", customRoleId: "role-1" }],
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });

    it("does not count expired invites", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      // Expired invites should be filtered by query, not returned
      expect(result).toBe(0);
    });

    it("does not count EXTERNAL role users without team assignment as full members (they are Lite Member)", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.teamUser.findMany.mockResolvedValue([]); // No team assignment
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });

    it("returns zero when no full members exist", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });

    it("combines users and pending invites in total count", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.ADMIN },
        { userId: "u2", role: OrganizationUserRole.MEMBER },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.ADMIN,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(3);
    });
  });

  describe("getMembersLiteCount", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-03-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts EXTERNAL users without custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.teamUser.findMany.mockResolvedValue([
        { userId: "u1", assignedRoleId: null },
      ]);
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("counts EXTERNAL users with view-only custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.teamUser.findMany.mockResolvedValue([
        { userId: "u1", assignedRoleId: "role-1" },
      ]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "analytics:view"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("does not count EXTERNAL users with non-view custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.teamUser.findMany.mockResolvedValue([
        { userId: "u1", assignedRoleId: "role-1" },
      ]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "project:manage"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("does not count ADMIN or MEMBER users as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.ADMIN },
        { userId: "u2", role: OrganizationUserRole.MEMBER },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("counts pending invites with EXTERNAL role and no custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("counts pending invites with EXTERNAL role and view-only custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "analytics:view"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: [{ teamId: "team-1", customRoleId: "role-1" }],
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("does not count pending invites with non-view custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "project:update"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: [{ teamId: "team-1", customRoleId: "role-1" }],
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("does not count pending invites with ADMIN or MEMBER role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.ADMIN,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
        {
          role: OrganizationUserRole.MEMBER,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("returns zero when no Lite Member users exist", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("counts EXTERNAL users without team assignment as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.teamUser.findMany.mockResolvedValue([]); // No team assignment
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("combines users and pending invites in total count", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.teamUser.findMany.mockResolvedValue([
        { userId: "u1", assignedRoleId: null },
      ]);
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(2);
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

    it("scenario query excludes archived scenarios", async () => {
      await repository.getActiveScenarioCount(organizationId);

      const call = mockPrisma.scenario.count.mock.calls[0]?.[0];
      expect(call?.where).toHaveProperty("archivedAt", null);
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

