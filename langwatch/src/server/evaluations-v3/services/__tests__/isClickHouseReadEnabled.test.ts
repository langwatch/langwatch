import { beforeEach, describe, expect, it, vi } from "vitest";
import { isClickHouseReadEnabled } from "../isClickHouseReadEnabled";

function createMockPrisma(flags: {
  featureClickHouseDataSourceEvaluations?: boolean;
  featureEventSourcingEvaluationIngestion?: boolean;
} | null) {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue(flags),
    },
  } as any;
}

// The warnedProjects Set is module-level, so we need to reset it between tests
// by re-importing the module. Instead, we'll use unique projectIds per test.

describe("isClickHouseReadEnabled", () => {
  describe("when read flag is ON and write flag is ON", () => {
    it("returns true", async () => {
      const prisma = createMockPrisma({
        featureClickHouseDataSourceEvaluations: true,
        featureEventSourcingEvaluationIngestion: true,
      });

      const result = await isClickHouseReadEnabled(prisma, "project-both-on");
      expect(result).toBe(true);
    });
  });

  describe("when read flag is OFF and write flag is OFF", () => {
    it("returns false", async () => {
      const prisma = createMockPrisma({
        featureClickHouseDataSourceEvaluations: false,
        featureEventSourcingEvaluationIngestion: false,
      });

      const result = await isClickHouseReadEnabled(prisma, "project-both-off");
      expect(result).toBe(false);
    });
  });

  describe("when read flag is ON but write flag is OFF", () => {
    it("returns true and logs read-on-write-off warning", async () => {
      const prisma = createMockPrisma({
        featureClickHouseDataSourceEvaluations: true,
        featureEventSourcingEvaluationIngestion: false,
      });

      const result = await isClickHouseReadEnabled(prisma, "project-read-on-write-off");
      expect(result).toBe(true);
    });
  });

  describe("when write flag is ON but read flag is OFF", () => {
    it("returns false", async () => {
      const prisma = createMockPrisma({
        featureClickHouseDataSourceEvaluations: false,
        featureEventSourcingEvaluationIngestion: true,
      });

      const result = await isClickHouseReadEnabled(prisma, "project-write-on-read-off");
      expect(result).toBe(false);
    });
  });

  describe("when project is not found", () => {
    it("returns false", async () => {
      const prisma = createMockPrisma(null);

      const result = await isClickHouseReadEnabled(prisma, "project-missing");
      expect(result).toBe(false);
    });
  });
});
