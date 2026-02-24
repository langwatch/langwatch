/**
 * Unit tests for SuiteRepository.
 *
 * Tests CRUD operations (create, findById, findByIdIncludingArchived,
 * findAll, findAllArchived, update, archive, restore) using a mocked PrismaClient.
 *
 * @see specs/suites/suite-workflow.feature
 * @see specs/suites/suite-archiving.feature
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SuiteRepository } from "../suite.repository";
import type { PrismaClient, SimulationSuite } from "@prisma/client";

function makeSuiteRow(
  overrides: Partial<SimulationSuite> = {},
): SimulationSuite {
  return {
    id: "suite_abc123",
    projectId: "proj_1",
    name: "Critical Path",
    slug: "critical-path",
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
    simulationSuite: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
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
        (prisma.simulationSuite.create as ReturnType<typeof vi.fn>)
          .mockResolvedValue(expected);

        const result = await repository.create({
          projectId: "proj_1",
          name: "Critical Path",
          slug: "critical-path",
          scenarioIds: ["scen_1", "scen_2"],
          targets: [{ type: "http", referenceId: "agent_1" }],
          repeatCount: 1,
          labels: [],
        });

        expect(result).toBe(expected);
        const callArg = (prisma.simulationSuite.create as ReturnType<typeof vi.fn>)
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
        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(expected);

        const result = await repository.findById({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        expect(result).toBe(expected);
        expect(prisma.simulationSuite.findFirst).toHaveBeenCalledWith({
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
        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
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
        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(null);

        const result = await repository.findById({
          id: "suite_archived",
          projectId: "proj_1",
        });

        expect(result).toBeNull();
        expect(prisma.simulationSuite.findFirst).toHaveBeenCalledWith({
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
        (prisma.simulationSuite.findMany as ReturnType<typeof vi.fn>)
          .mockResolvedValue(suites);

        const result = await repository.findAll({ projectId: "proj_1" });

        expect(result).toEqual(suites);
        expect(prisma.simulationSuite.findMany).toHaveBeenCalledWith({
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
        (prisma.simulationSuite.findMany as ReturnType<typeof vi.fn>)
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
        (prisma.simulationSuite.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(updated);

        const result = await repository.update({
          id: "suite_abc123",
          projectId: "proj_1",
          data: { name: "Updated Name" },
        });

        expect(result).toBe(updated);
        expect(prisma.simulationSuite.update).toHaveBeenCalledWith({
          where: { id: "suite_abc123", projectId: "proj_1", archivedAt: null },
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

        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(existing);
        (prisma.simulationSuite.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(archived);

        const result = await repository.archive({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        expect(result).toBe(archived);
        expect(prisma.simulationSuite.update).toHaveBeenCalledWith({
          where: { id: "suite_abc123", projectId: "proj_1" },
          data: {
            archivedAt: expect.any(Date),
            slug: "critical-path--archived",
          },
        });
      });
    });

    describe("given a non-existent suite", () => {
      it("returns null without attempting update", async () => {
        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(null);

        const result = await repository.archive({
          id: "suite_nonexistent",
          projectId: "proj_1",
        });

        expect(result).toBeNull();
        expect(prisma.simulationSuite.update).not.toHaveBeenCalled();
      });
    });

    describe("given an already-archived suite", () => {
      it("preserves the original archivedAt timestamp", async () => {
        const originalDate = new Date("2026-01-15");
        const existing = makeSuiteRow({ archivedAt: originalDate, slug: "critical-path--archived" });
        const archived = makeSuiteRow({ archivedAt: originalDate, slug: "critical-path--archived" });

        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(existing);
        (prisma.simulationSuite.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(archived);

        await repository.archive({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        const updateCall = (prisma.simulationSuite.update as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(updateCall.data.archivedAt).toBe(originalDate);
      });

      it("does not stack --archived suffixes", async () => {
        const existing = makeSuiteRow({
          archivedAt: new Date("2026-01-15"),
          slug: "critical-path--archived",
        });

        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(existing);
        (prisma.simulationSuite.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(existing);

        await repository.archive({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        const updateCall = (prisma.simulationSuite.update as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(updateCall.data.slug).toBe("critical-path--archived");
      });
    });
  });

  describe("findByIdIncludingArchived()", () => {
    describe("given an archived suite", () => {
      it("returns the suite without filtering by archivedAt", async () => {
        const archived = makeSuiteRow({ archivedAt: new Date("2026-02-01") });
        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(archived);

        const result = await repository.findByIdIncludingArchived({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        expect(result).toBe(archived);
        expect(prisma.simulationSuite.findFirst).toHaveBeenCalledWith({
          where: {
            id: "suite_abc123",
            projectId: "proj_1",
          },
        });
      });
    });

    describe("given a non-existent suite", () => {
      it("returns null", async () => {
        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(null);

        const result = await repository.findByIdIncludingArchived({
          id: "suite_nonexistent",
          projectId: "proj_1",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("findAllArchived()", () => {
    describe("given a project with archived suites", () => {
      it("returns only archived suites ordered by archivedAt desc", async () => {
        const archivedSuites = [
          makeSuiteRow({ id: "suite_1", archivedAt: new Date("2026-02-01") }),
          makeSuiteRow({ id: "suite_2", archivedAt: new Date("2026-01-15") }),
        ];
        (prisma.simulationSuite.findMany as ReturnType<typeof vi.fn>)
          .mockResolvedValue(archivedSuites);

        const result = await repository.findAllArchived({ projectId: "proj_1" });

        expect(result).toEqual(archivedSuites);
        expect(prisma.simulationSuite.findMany).toHaveBeenCalledWith({
          where: {
            projectId: "proj_1",
            archivedAt: { not: null },
          },
          orderBy: { archivedAt: "desc" },
        });
      });
    });

    describe("given no archived suites", () => {
      it("returns an empty array", async () => {
        (prisma.simulationSuite.findMany as ReturnType<typeof vi.fn>)
          .mockResolvedValue([]);

        const result = await repository.findAllArchived({ projectId: "proj_1" });

        expect(result).toEqual([]);
      });
    });
  });

  describe("restore()", () => {
    describe("given an archived suite with --archived slug", () => {
      it("strips the --archived suffix and clears archivedAt", async () => {
        const archived = makeSuiteRow({
          archivedAt: new Date("2026-02-01"),
          slug: "critical-path--archived",
        });
        const restored = makeSuiteRow({ archivedAt: null, slug: "critical-path" });

        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(archived);
        (prisma.simulationSuite.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(restored);

        const result = await repository.restore({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        expect(result).toBe(restored);
        expect(prisma.simulationSuite.update).toHaveBeenCalledWith({
          where: { id: "suite_abc123", projectId: "proj_1" },
          data: { archivedAt: null, slug: "critical-path" },
        });
      });
    });

    describe("given an archived suite without --archived suffix", () => {
      it("preserves the slug as-is and clears archivedAt", async () => {
        const archived = makeSuiteRow({
          archivedAt: new Date("2026-02-01"),
          slug: "legacy-slug",
        });
        const restored = makeSuiteRow({ archivedAt: null, slug: "legacy-slug" });

        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(archived);
        (prisma.simulationSuite.update as ReturnType<typeof vi.fn>)
          .mockResolvedValue(restored);

        await repository.restore({
          id: "suite_abc123",
          projectId: "proj_1",
        });

        expect(prisma.simulationSuite.update).toHaveBeenCalledWith({
          where: { id: "suite_abc123", projectId: "proj_1" },
          data: { archivedAt: null, slug: "legacy-slug" },
        });
      });
    });

    describe("given a non-existent suite", () => {
      it("returns null without attempting update", async () => {
        (prisma.simulationSuite.findFirst as ReturnType<typeof vi.fn>)
          .mockResolvedValue(null);

        const result = await repository.restore({
          id: "suite_nonexistent",
          projectId: "proj_1",
        });

        expect(result).toBeNull();
        expect(prisma.simulationSuite.update).not.toHaveBeenCalled();
      });
    });
  });
});
