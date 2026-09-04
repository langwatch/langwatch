/**
 * @vitest-environment node
 *
 * The query the dataset list issues. Boundary mock: `dataset.findMany` is a
 * spy, so the `where`, the page window and the record-count include are
 * assertable without a database.
 *
 * The archived predicate is the load-bearing part — an archived dataset keeps
 * its row and a mangled slug, so a list that forgot `archivedAt: null` would
 * hand deleted datasets back to every API consumer.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaDatasetRepository } from "../prisma.dataset.repository";

const NOW = new Date(0);

const row = (id: string, recordCount: number) => ({
  id,
  projectId: "project-1",
  name: `Dataset ${id}`,
  slug: `dataset-${id}`,
  columnTypes: [{ name: "input", type: "string" }],
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  mapping: null,
  _count: { datasetRecords: recordCount },
});

describe("PrismaDatasetRepository", () => {
  describe("given a project holding datasets and archived datasets", () => {
    describe("when a page of them is listed", () => {
      /** @scenario "List datasets returns paginated non-archived datasets" */
      it("asks only for the live rows, windowed, each with its record count", async () => {
        const findMany = vi.fn().mockResolvedValue([row("a", 2), row("b", 0), row("c", 7)]);
        const prisma = { dataset: { findMany } } as unknown as PrismaClient;

        const listed = await PrismaDatasetRepository.create(prisma).list({
          projectId: "project-1",
          page: 2,
          limit: 5,
        });

        expect(findMany).toHaveBeenCalledWith({
          where: { projectId: "project-1", archivedAt: null },
          orderBy: { createdAt: "desc" },
          skip: 5,
          take: 5,
          include: { _count: { select: { datasetRecords: true } } },
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
