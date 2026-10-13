import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaUsageMembershipRepository } from "../prisma.usage-membership.repository.ts";

/**
 * Unit tests for PrismaUsageMembershipRepository.
 */

// Create mock Prisma client
const createMockPrisma = () => ({
  project: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
  cost: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
  },
});

type MockPrisma = ReturnType<typeof createMockPrisma>;

describe("PrismaUsageMembershipRepository", () => {
  let repository: PrismaUsageMembershipRepository;
  let mockPrisma: MockPrisma;
  const organizationId = "org-123";

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    repository = PrismaUsageMembershipRepository.create(prismaDouble(mockPrisma));
  });

  describe("when finding the current month's cost", () => {
    /** @scenario "findCurrentMonthCost remains available in the repository" */
    it("fetches project IDs and aggregates cost for current month", async () => {
      mockPrisma.project.findMany.mockResolvedValue([{ id: "proj-1" }, { id: "proj-2" }]);
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: 150.5 } });

      const result = await repository.findCurrentMonthCost(organizationId);

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

      const result = await repository.findCurrentMonthCost(organizationId);

      expect(result).toBe(0);
    });

    it("returns zero when no projects exist", async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      const result = await repository.findCurrentMonthCost(organizationId);

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

      await repository.findCurrentMonthCost(organizationId);

      const call = mockPrisma.cost.aggregate.mock.calls[0]?.[0];
      const dateFilter = call?.where?.createdAt?.gte as Date;

      expect(dateFilter.getFullYear()).toBe(2024);
      expect(dateFilter.getMonth()).toBe(2); // March (0-indexed)
      expect(dateFilter.getDate()).toBe(1);

      vi.useRealTimers();
    });
  });

  describe("when finding the current month's cost for projects", () => {
    it("aggregates cost for specified project IDs", async () => {
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: 75.25 } });
      const projectIds = ["proj-a", "proj-b", "proj-c"];

      const result = await repository.findCurrentMonthCostForProjects(projectIds);

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

      const result = await repository.findCurrentMonthCostForProjects(["proj-1"]);

      expect(result).toBe(0);
    });

    it("handles empty project array", async () => {
      mockPrisma.cost.aggregate.mockResolvedValue({ _sum: { amount: null } });

      const result = await repository.findCurrentMonthCostForProjects([]);

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
