import { DatasetConflictError, type Dataset } from "@langwatch/dataset-contract";
/**
 * Dataset names are unique per project by slug. The editor asks whether a name is free, and a
 * copy asks for the next name that is — neither may hand back a slug that already belongs to
 * another dataset.
 */
import { describe, expect, it } from "vitest";

import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetNamingService } from "../dataset-naming.service.ts";

const PROJECT_ID = "project-1";

type SlugLookup = { slug: string; projectId: string; excludeId?: string };

function datasetHolding({ id, slug }: { id: string; slug: string }): Dataset {
  return {
    id,
    projectId: PROJECT_ID,
    name: slug,
    slug,
    columnTypes: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    mapping: null,
    useS3: false,
    s3RecordCount: null,
    contentLayout: "postgres",
    status: "ready",
    statusError: null,
    stagingKey: null,
    uploadFilename: null,
    rowCount: null,
    sizeBytes: null,
    chunkCount: null,
    chunkOffsets: null,
  };
}

function repositoryWith(findBySlug: (input: SlugLookup) => Promise<Dataset | null>) {
  return Object.assign(
    MemoryDatasetRepository.create({ database: MemoryDatasetDatabase.create() }),
    { findBySlug },
  );
}

function namingOver(takenSlugs: Record<string, string>) {
  const calls: { slug: string; excludeId?: string }[] = [];
  const repository = repositoryWith(async ({ slug, excludeId }) => {
    calls.push({ slug, ...(excludeId ? { excludeId } : {}) });
    const id = takenSlugs[slug];

    return id && id !== excludeId ? datasetHolding({ id, slug }) : null;
  });

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
      const repository = repositoryWith(async ({ slug }) =>
        datasetHolding({ id: `dataset-${slug}`, slug }),
      );

      await expect(
        DatasetNamingService.create(repository).findNextAvailableName({
          projectId: PROJECT_ID,
          proposedName: "Refunds",
        }),
      ).rejects.toBeInstanceOf(DatasetConflictError);
    });
  });
});
