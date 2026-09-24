import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { PrismaDatasetRepository } from "../prisma.dataset.repository.ts";

const NOW = new Date(0);

const row = (id: string) => ({
  id,
  projectId: "project-1",
  name: `Dataset ${id}`,
  slug: `dataset-${id}`,
  columnTypes: [{ name: "input", type: "string" }],
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  mapping: null,
});

describe("PrismaDatasetRepository", () => {
  describe("given a project holding datasets and archived datasets", () => {
    describe("when a page of them is listed", () => {
      /** @scenario "List datasets returns paginated non-archived datasets" */
      it("asks only for the live rows, windowed, each with its record count", async () => {
        const findMany = vi.fn().mockResolvedValue([row("a"), row("b"), row("c")]);
        const groupBy = vi.fn().mockResolvedValue([
          { datasetId: "a", _count: { _all: 2 } },
          { datasetId: "c", _count: { _all: 7 } },
        ]);
        const prisma = prismaDouble({ dataset: { findMany }, datasetRecord: { groupBy } });

        const listed = await PrismaDatasetRepository.create({ prisma }).findAll({
          projectId: "project-1",
          page: 2,
          limit: 5,
        });

        expect(findMany).toHaveBeenCalledWith({
          where: { projectId: "project-1", archivedAt: null },
          orderBy: { createdAt: "desc" },
          skip: 5,
          take: 5,
        });
        expect(groupBy).toHaveBeenCalledWith({
          by: ["datasetId"],
          where: { projectId: "project-1", datasetId: { in: ["a", "b", "c"] } },
          _count: { _all: true },
        });
        expect(
          listed.map(({ id, name, slug, columnTypes, recordCount }) => ({
            id,
            name,
            slug,
            columnTypes,
            recordCount,
          })),
        ).toEqual([
          {
            id: "a",
            name: "Dataset a",
            slug: "dataset-a",
            columnTypes: [{ name: "input", type: "string" }],
            recordCount: 2,
          },
          {
            id: "b",
            name: "Dataset b",
            slug: "dataset-b",
            columnTypes: [{ name: "input", type: "string" }],
            recordCount: 0,
          },
          {
            id: "c",
            name: "Dataset c",
            slug: "dataset-c",
            columnTypes: [{ name: "input", type: "string" }],
            recordCount: 7,
          },
        ]);
      });
    });
  });
});
