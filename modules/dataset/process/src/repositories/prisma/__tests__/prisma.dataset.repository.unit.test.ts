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
  status: "ready",
});

/** What the list's `select` answers: no tenant or storage columns. */
const summaryRow = (id: string) => {
  const { projectId: _projectId, ...summary } = row(id);
  return summary;
};

describe("PrismaDatasetRepository", () => {
  describe("given a project holding datasets and archived datasets", () => {
    describe("when a page of them is listed", () => {
      /** @scenario "List datasets returns paginated non-archived datasets" */
      it("asks only for the live rows, windowed, and only the columns a list renders", async () => {
        const findMany = vi.fn().mockResolvedValue([summaryRow("a"), summaryRow("b")]);
        const groupBy = vi.fn();
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
          select: {
            id: true,
            name: true,
            slug: true,
            columnTypes: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        expect(groupBy).not.toHaveBeenCalled();
        expect(listed.map(({ id, name, slug }) => ({ id, name, slug }))).toEqual([
          { id: "a", name: "Dataset a", slug: "dataset-a" },
          { id: "b", name: "Dataset b", slug: "dataset-b" },
        ]);
      });
    });
  });

  describe("given a dataset in the caller's project", () => {
    describe("when it is updated", () => {
      /** @scenario "A dataset update is pinned to the caller's project" */
      it("matches the row by its id and its project", async () => {
        const update = vi.fn().mockResolvedValue(row("a"));
        const prisma = prismaDouble({ dataset: { update } });

        await PrismaDatasetRepository.create({ prisma }).update({
          id: "a",
          projectId: "project-1",
          name: "Dataset a",
          slug: "dataset-a",
          columnTypes: [{ name: "input", type: "string" }],
        });

        expect(update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: "a", projectId: "project-1" } }),
        );
      });
    });
  });
});
