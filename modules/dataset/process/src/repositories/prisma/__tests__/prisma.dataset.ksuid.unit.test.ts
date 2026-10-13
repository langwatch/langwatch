/**
 * @vitest-environment node
 */
import { parse } from "@langwatch/ksuid";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaDatasetContentRepository } from "../prisma.dataset-content.repository.ts";
import { PrismaDatasetRepository } from "../prisma.dataset.repository.ts";

const NOW = new Date(0);

function createdRow({ data }: { data: Record<string, unknown> }) {
  return Promise.resolve({ ...data, createdAt: NOW, updatedAt: NOW, archivedAt: null });
}

describe("Postgres datasets", () => {
  describe("when the dataset repository creates a dataset", () => {
    /** @scenario "A dataset created in Postgres is stored under a strict dataset KSUID" */
    it("mints the id as a dataset KSUID", async () => {
      const create = vi.fn(createdRow);
      const repository = PrismaDatasetRepository.create({
        prisma: prismaDouble({ dataset: { create } }),
      });

      await repository.create({
        projectId: "project-1",
        name: "Reviews",
        slug: "reviews",
        columnTypes: [{ name: "input", type: "string" }],
      });

      expect(parse(String(create.mock.calls[0]![0].data.id)).resource).toBe("dataset");
    });
  });

  describe("when the dataset content repository creates a dataset", () => {
    /** @scenario "A dataset created in Postgres is stored under a strict dataset KSUID" */
    it("mints the id as a dataset KSUID", async () => {
      const create = vi.fn(createdRow);
      const repository = PrismaDatasetContentRepository.create({
        prisma: prismaDouble({ dataset: { create } }),
      });

      await repository.create({
        projectId: "project-1",
        name: "Reviews",
        slug: "reviews",
        columnTypes: [{ name: "input", type: "string" }],
      });

      expect(parse(String(create.mock.calls[0]![0].data.id)).resource).toBe("dataset");
    });
  });
});
