/**
 * A listed dataset's record count comes from one grouped count over the page's
 * datasets, not a per-row `_count`.
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaDatasetRepository } from "../prisma.dataset.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaDatasetRepository record counts", () => {
  const namespace = `dataset-record-counts-${randomUUID()}`;
  const organizationId = `${namespace}-organization`;
  const teamId = `${namespace}-team`;
  const projectId = `${namespace}-project`;
  const fullId = `${namespace}-full`;
  const emptyId = `${namespace}-empty`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:record-counts"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaDatasetRepository.create({ prisma });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        teamId,
        name: projectId,
        slug: projectId,
        apiKey: projectId,
        language: "typescript",
        framework: "test",
      },
    });
    for (const [id, createdAt] of [
      [fullId, new Date(2_000)],
      [emptyId, new Date(1_000)],
    ] as const) {
      await prisma.dataset.create({
        data: { id, projectId, name: id, slug: id, columnTypes: [], createdAt },
      });
    }
    for (let index = 0; index < 3; index++) {
      await prisma.datasetRecord.create({
        data: { datasetId: fullId, projectId, entry: { index } },
      });
    }
  });

  afterAll(async () => {
    await prisma.datasetRecord.deleteMany({ where: { projectId } });
    await prisma.dataset.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when a page of datasets is listed", () => {
    it("counts each dataset's records, and zero for a dataset holding none", async () => {
      const listed = await repository.findAll({ projectId, page: 1, limit: 10 });

      expect(listed.map(({ id, recordCount }) => ({ id, recordCount }))).toEqual([
        { id: fullId, recordCount: 3 },
        { id: emptyId, recordCount: 0 },
      ]);
    });
  });
});
