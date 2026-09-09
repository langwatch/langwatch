/**
 * Dataset names are unique per project by slug. The editor asks whether a name is free, and a
 * copy asks for the next name that is — neither may hand back a slug that already belongs to
 * another dataset.
 */
import { describe, expect, it } from "vitest";
import { DatasetConflictError } from "@langwatch/dataset-contract";
import type { DatasetRepository } from "../../repositories/dataset.repository.ts";
import { DatasetNamingService } from "../dataset-naming.service.ts";

const PROJECT_ID = "project-1";

function namingOver(takenSlugs: Record<string, string>) {
  const calls: { slug: string; excludeId?: string }[] = [];
  const repository = {
    findBySlug: async ({ slug, excludeId }: { slug: string; excludeId?: string }) => {
      calls.push({ slug, ...(excludeId ? { excludeId } : {}) });
      const id = takenSlugs[slug];

      return id && id !== excludeId ? { id, slug } : null;
    },
  } as unknown as DatasetRepository;

  return { service: DatasetNamingService.create(repository), calls };
}

describe("DatasetNamingService", () => {
  describe("when the proposed name is free", () => {
    it("reports it available with the slug it would take", async () => {
      const { service } = namingOver({});

      await expect(
        service.validateDatasetName({ projectId: PROJECT_ID, proposedName: "Refund cases" }),
      ).resolves.toEqual({ available: true, slug: "refund-cases" });
    });
  });

  describe("when the slug already belongs to another dataset", () => {
    it("reports it unavailable and names the holder", async () => {
      const { service } = namingOver({ refunds: "dataset-1" });

      await expect(
        service.validateDatasetName({ projectId: PROJECT_ID, proposedName: "Refunds" }),
      ).resolves.toEqual({ available: false, slug: "refunds", conflictsWith: "dataset-1" });
    });
  });

  describe("when the dataset holding the slug is the one being renamed", () => {
    it("reports the name available", async () => {
      const { service } = namingOver({ refunds: "dataset-1" });

      await expect(
        service.validateDatasetName({
          projectId: PROJECT_ID,
          proposedName: "Refunds",
          excludeDatasetId: "dataset-1",
        }),
      ).resolves.toEqual({ available: true, slug: "refunds" });
    });
  });

  describe("when asked for the next available name", () => {
    it("returns the trimmed base name when it is free", async () => {
      const { service } = namingOver({});

      await expect(
        service.findNextAvailableName({ projectId: PROJECT_ID, proposedName: "  Refunds  " }),
      ).resolves.toBe("Refunds");
    });

    it("numbers past every taken variant", async () => {
      const { service } = namingOver({
        refunds: "dataset-1",
        "refunds-2": "dataset-2",
        "refunds-3": "dataset-3",
      });

      await expect(
        service.findNextAvailableName({ projectId: PROJECT_ID, proposedName: "Refunds" }),
      ).resolves.toBe("Refunds 4");
    });
  });

  describe("when every candidate name is taken", () => {
    it("refuses rather than looping forever", async () => {
      const repository = {
        findBySlug: async ({ slug }: { slug: string }) => ({ id: `dataset-${slug}` }),
      } as unknown as DatasetRepository;

      await expect(
        DatasetNamingService.create(repository).findNextAvailableName({
          projectId: PROJECT_ID,
          proposedName: "Refunds",
        }),
      ).rejects.toBeInstanceOf(DatasetConflictError);
    });
  });
});
