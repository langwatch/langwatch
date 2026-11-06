/**
 * The read-only dataset storage audit over Postgres: what each organization still has to move to
 * object storage or to clean out of the records table, with nothing written.
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
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaDatasetStorageAuditRepository } from "../../repositories/prisma/prisma.dataset-storage-audit.repository.ts";
import { DatasetStorageAuditService } from "../../services/dataset-storage-audit.service.ts";
import { DatasetStorageAuditTask } from "../dataset-storage-audit.task.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("the dataset storage audit", () => {
  const namespace = `dataset-storage-audit-${randomUUID()}`;
  const organizationId = `${namespace}-organization`;
  const teamId = `${namespace}-team`;
  const projectId = `${namespace}-project`;
  const otherProjectId = `${namespace}-other-project`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:storage-audit"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  /** Every dataset and records-table row of the project, as a fingerprint of what is stored. */
  const stored = async () => ({
    datasets: await prisma.dataset.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
    records: await prisma.datasetRecord.findMany({
      where: { projectId: { in: [projectId, otherProjectId] } },
      orderBy: { id: "asc" },
    }),
  });

  const dataset = (id: string, data: { contentLayout?: string; useS3?: boolean } = {}) =>
    prisma.dataset.create({
      data: { id, projectId, name: id, slug: id, columnTypes: [], ...data },
    });
  const rows = (datasetId: string, count: number) =>
    prisma.datasetRecord.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        id: `${datasetId}-row-${index}`,
        datasetId,
        projectId,
        entry: { input: `row ${index}` },
      })),
    });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    for (const id of [projectId, otherProjectId]) {
      await prisma.project.create({
        data: {
          id,
          teamId,
          name: id,
          slug: id,
          apiKey: id,
          language: "typescript",
          framework: "test",
        },
      });
    }
    await dataset(`${namespace}-first`, { contentLayout: "postgres" });
    await rows(`${namespace}-first`, 4);
    await dataset(`${namespace}-second`, { contentLayout: "postgres" });
    await rows(`${namespace}-second`, 3);
    await dataset(`${namespace}-single-file`, { contentLayout: "postgres", useS3: true });
    await dataset(`${namespace}-moved`, { contentLayout: "s3_jsonl" });
    await rows(`${namespace}-moved`, 5);
    // Real installs hold rows filed under another project than their dataset's, and rows whose
    // dataset is gone: the audit counts them apart, never as rows to move.
    await prisma.datasetRecord.createMany({
      data: [
        {
          id: `${namespace}-misfiled`,
          datasetId: `${namespace}-first`,
          projectId: otherProjectId,
          entry: { input: "misfiled" },
        },
        {
          id: `${namespace}-orphan`,
          datasetId: `${namespace}-gone`,
          projectId,
          entry: { input: "orphan" },
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.datasetRecord.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } },
    });
    await prisma.dataset.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("given an organization with datasets still in the records table", () => {
    /** @scenario "The dataset storage audit lists what is left per organization without changing anything" */
    it("shows what is left for that organization and changes nothing", async () => {
      const before = await stored();
      const { logger, lines } = createTestLogger();
      const task = DatasetStorageAuditTask.create({
        audit: DatasetStorageAuditService.create({
          repository: PrismaDatasetStorageAuditRepository.create({ database: prisma }),
          projects: {
            listAllWithOrganization: async () => ({
              projects: [
                { id: projectId, organizationId },
                { id: otherProjectId, organizationId },
              ],
              orphanIds: [],
              next: null,
            }),
          },
        }),
        logger,
      });

      await task.run({ args: [], signal: new AbortController().signal });

      expect(lines.findLine("info", "Dataset storage left for one organization")).toMatchObject({
        organizationId,
        recordsTableDatasets: 2,
        recordsTableRows: 7,
        singleFileDatasets: 1,
        rowsAwaitingCleanup: 5,
        rowsUnderOtherProject: 1,
        orphanRows: 1,
      });
      expect(lines.findLine("info", "Dataset storage left in total")).toMatchObject({
        organizations: 1,
        recordsTableDatasets: 2,
      });
      expect(await stored()).toEqual(before);
    });
  });
});
