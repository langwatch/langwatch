/**
 * Unit tests for SuiteRepository.
 *
 * Tests CRUD operations (create, findById, findAll, update, archive)
 * using a mocked PrismaClient.
 *
 * @see specs/suites/suite-workflow.feature
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SuiteRepository } from "../suite.repository";
import type { PrismaClient, SimulationSuiteConfiguration } from "@prisma/client";

function makeSuiteRow(
  overrides: Partial<SimulationSuiteConfiguration> = {},
): SimulationSuiteConfiguration {
  return {
    id: "suite_abc123",
    projectId: "proj_1",
    name: "Critical Path",
    description: null,
    scenarioIds: ["scen_1", "scen_2"],
    targets: [{ type: "http", referenceId: "agent_1" }],
    repeatCount: 1,
    labels: [],
    archivedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMockPrisma() {
  return {
    simulationSuiteConfiguration: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("SuiteRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repository: SuiteRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repository = new SuiteRepository(prisma);
  });

  describe("create()", () => {
    describe("given valid input", () => {
      it("inserts a new suite with a generated id", async () => {
        const expected = makeSuiteRow();
        (prisma.simulationSuiteConfiguration.create as ReturnType<typeof vi.fn>)
          .mockResolvedValue(expected);

        const result = await repository.create({
          projectId: "proj_1",
          name: "Critical Path",
          scenarioIds: ["scen_1", "scen_2"],
          targets: [{ type: "http", referenceId: "agent_1" }],
          repeatCount: 1,
          labels: [],
        });

        expect(result).toBe(expected);
        const callArg = (prisma.simulationSuiteConfiguration.create as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(callArg.data.id).toMatch(/^suite_/);
        expect(callArg.data.projectId).toBe("proj_1");
        expect(callArg.data.name).toBe("Critical Path");
      });
    });
  });

  describe("findById()", () => {
    describe("given an existing suite id and project", () => {
      it("returns the suite", async () => {
        const expected = makeSuiteRow();
        (prisma.simulationSuiteConfiguration.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(expected);

        const result = await repository.findById({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        expect(result).toBe(expected);
        expect(prisma.simulationSuiteConfiguration.findFirst).toHaveBeenCalledWith({
          where: {
            id: "suite_abc123",
            projectId: "proj_1",
            archivedAt: null,
          },
        });
      });
    });

    describe("given a non-existent suite id", () => {
      it("returns null", async () => {
        (prisma.simulationSuiteConfiguration.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(null);

        const result = await repository.findById({
          id: "suite_nonexistent",
          projectId: "proj_1",
        });

        expect(result).toBeNull();
      });
    });

    describe("given an archived suite", () => {
      it("returns null because archivedAt filter excludes it", async () => {
        (prisma.simulationSuiteConfiguration.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(null);

        const result = await repository.findById({
          id: "suite_archived",
          projectId: "proj_1",
        });

        expect(result).toBeNull();
        expect(prisma.simulationSuiteConfiguration.findFirst).toHaveBeenCalledWith({
          where: expect.objectContaining({ archivedAt: null }),
        });
      });
    });
  });

  describe("findAll()", () => {
    describe("given a project with multiple suites", () => {
      it("returns all non-archived suites ordered by updatedAt desc", async () => {
        const suites = [
          makeSuiteRow({ id: "suite_1", name: "Suite A" }),
          makeSuiteRow({ id: "suite_2", name: "Suite B" }),
        ];
        (prisma.simulationSuiteConfiguration.findMany as ReturnType<typeof vi.fn>)
          .mockResolvedValue(suites);

        const result = await repository.findAll({ projectId: "proj_1" });

        expect(result).toEqual(suites);
        expect(prisma.simulationSuiteConfiguration.findMany).toHaveBeenCalledWith({
          where: {
            projectId: "proj_1",
            archivedAt: null,
          },
          orderBy: { updatedAt: "desc" },
        });
      });
    });

    describe("given a project with no suites", () => {
      it("returns an empty array", async () => {
        (prisma.simulationSuiteConfiguration.findMany as ReturnType<typeof vi.fn>)
          .mockResolvedValue([]);

        const result = await repository.findAll({ projectId: "proj_1" });

        expect(result).toEqual([]);
      });
    });
  });

  describe("update()", () => {
    describe("given a valid suite id and update data", () => {
      it("updates and returns the suite", async () => {
        const updated = makeSuiteRow({ name: "Updated Name" });
        (prisma.simulationSuiteConfiguration.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(updated);

        const result = await repository.update({
          id: "suite_abc123",
          projectId: "proj_1",
          data: { name: "Updated Name" },
        });

        expect(result).toBe(updated);
        expect(prisma.simulationSuiteConfiguration.update).toHaveBeenCalledWith({
          where: { id: "suite_abc123", projectId: "proj_1" },
          data: { name: "Updated Name" },
        });
      });
    });
  });

  describe("archive()", () => {
    describe("given an existing suite", () => {
      it("sets archivedAt timestamp and returns the archived suite", async () => {
        const existing = makeSuiteRow({ archivedAt: null });
        const archived = makeSuiteRow({ archivedAt: new Date("2026-02-01") });

        (prisma.simulationSuiteConfiguration.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(existing);
        (prisma.simulationSuiteConfiguration.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(archived);

        const result = await repository.archive({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        expect(result).toBe(archived);
        expect(prisma.simulationSuiteConfiguration.update).toHaveBeenCalledWith({
          where: { id: "suite_abc123", projectId: "proj_1" },
          data: { archivedAt: expect.any(Date) },
        });
      });
    });

    describe("given a non-existent suite", () => {
      it("returns null without attempting update", async () => {
        (prisma.simulationSuiteConfiguration.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(null);

        const result = await repository.archive({
          id: "suite_nonexistent",
          projectId: "proj_1",
        });

        expect(result).toBeNull();
        expect(prisma.simulationSuiteConfiguration.update).not.toHaveBeenCalled();
      });
    });

    describe("given an already-archived suite", () => {
      it("preserves the original archivedAt timestamp", async () => {
        const originalDate = new Date("2026-01-15");
        const existing = makeSuiteRow({ archivedAt: originalDate });
        const archived = makeSuiteRow({ archivedAt: originalDate });

        (prisma.simulationSuiteConfiguration.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(existing);
        (prisma.simulationSuiteConfiguration.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(archived);

        await repository.archive({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        const updateCall = (prisma.simulationSuiteConfiguration.update as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(updateCall.data.archivedAt).toBe(originalDate);
      });
    });
  });
});
