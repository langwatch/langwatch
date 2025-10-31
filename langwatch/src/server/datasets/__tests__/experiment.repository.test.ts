import { describe, it, expect, beforeEach, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { ExperimentRepository } from "../experiment.repository";

describe("ExperimentRepository", () => {
  let prisma: PrismaClient;
  let repository: ExperimentRepository;

  beforeEach(() => {
    prisma = {
      experiment: {
        findFirst: vi.fn(),
      },
    } as unknown as PrismaClient;
    repository = new ExperimentRepository(prisma);
  });

  describe("findExperiment", () => {
    describe("when experiment exists", () => {
      it("returns matching experiment by id and projectId", async () => {
        const mockExperiment = { id: "exp-1", projectId: "proj-1", name: "Test Exp" };
        vi.mocked(prisma.experiment.findFirst).mockResolvedValue(mockExperiment as any);

        const result = await repository.findExperiment({
          id: "exp-1",
          projectId: "proj-1",
        });

        expect(result).toEqual(mockExperiment);
        expect(prisma.experiment.findFirst).toHaveBeenCalledWith({
          where: { id: "exp-1", projectId: "proj-1" },
        });
      });
    });

    describe("when experiment not found", () => {
      it("returns null", async () => {
        vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

        const result = await repository.findExperiment({
          id: "missing",
          projectId: "proj-1",
        });

        expect(result).toBeNull();
      });
    });

    describe("when experiment from different project exists", () => {
      it("returns null", async () => {
        vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

        const result = await repository.findExperiment({
          id: "exp-1",
          projectId: "wrong-project",
        });

        expect(result).toBeNull();
      });
    });
  });
});

