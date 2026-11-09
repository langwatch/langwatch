/**
 * The remaining-content move over Postgres, the move the step runs: a dataset whose chunks
 * object storage refuses stays on the records table, readable and untouched, and the step
 * does not finish.
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
import { memoryObjectStorage } from "@langwatch/process-stores";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatasetTestApp } from "../../app/__tests__/dataset.fixture.ts";
import { PostgresDatasetRepositories } from "../../repositories/prisma/prisma.dataset.repositories.ts";
import { DatasetMigrationService } from "../dataset-migration.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("the remaining-content move over Postgres", () => {
  const namespace = `dataset-remaining-move-${randomUUID()}`;
  const organizationId = `${namespace}-organization`;
  const teamId = `${namespace}-team`;
  const projectId = `${namespace}-project`;
  const otherProjectId = `${namespace}-other`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:remaining-move"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const objectStorage = memoryObjectStorage();
  const repositories = PostgresDatasetRepositories.create({
    prisma,
    objectStorage,
    config: { singleFileStorage: { onLocalDisk: false, localPath: undefined } },
  });
  const app = createDatasetTestApp({ repositories });
  const step = () =>
    DatasetMigrationService.create({
      repository: repositories.migration,
      storage: repositories.migrationChunks,
      projects: { listAllIds: async () => ({ ids: [projectId], next: null }) },
    }).runStep({
      checkpoint: { resumeFrom: null, save: async () => undefined },
      dryRun: false,
      signal: new AbortController().signal,
      log: { info: () => undefined, warn: () => undefined },
    });

  /** A records-table dataset with these rows; `under` files a row under another project. */
  const recordsTableDataset = async (rows: { input: string; under?: string }[]) => {
    const datasetId = `${namespace}-${randomUUID()}`;
    await prisma.dataset.create({
      data: {
        id: datasetId,
        projectId,
        name: datasetId,
        slug: datasetId,
        columnTypes: [{ name: "input", type: "string" }],
        contentLayout: "postgres",
      },
    });
    for (const [index, row] of rows.entries()) {
      await prisma.datasetRecord.create({
        data: {
          id: `${datasetId}-row-${index}`,
          datasetId,
          projectId: row.under ?? projectId,
          entry: { input: row.input },
          createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)),
        },
      });
    }
    return datasetId;
  };
  const tableRows = (datasetId: string) =>
    prisma.datasetRecord.findMany({
      where: { datasetId, projectId },
      select: { id: true, entry: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    });
  const layout = async (datasetId: string) =>
    (
      await prisma.dataset.findFirst({
        where: { id: datasetId, projectId },
        select: { contentLayout: true },
      })
    )?.contentLayout;
  const readRows = async (datasetId: string) =>
    (
      await app.getDatasetWithRecords({ projectId, slugOrId: datasetId, limitMb: null })
    ).records.map((record) => record.entry.input);

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
  });

  /** Every row first: a row filed under the other project still points at a dataset here. */
  const clear = async () => {
    for (const id of [projectId, otherProjectId]) {
      await prisma.datasetRecord.deleteMany({ where: { projectId: id } });
    }
    await prisma.dataset.deleteMany({ where: { projectId } });
  };

  beforeEach(clear);

  afterAll(async () => {
    await clear();
    for (const id of [projectId, otherProjectId]) {
      await prisma.project.deleteMany({ where: { id } });
    }
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("given object storage refuses the chunk writes of one dataset", () => {
    /** @scenario "A dataset that fails to move stays readable from the records table" */
    it("keeps that dataset on the records table, untouched, and does not finish the step", async () => {
      const refused = await recordsTableDataset([
        { input: "one" },
        { input: "two" },
        { input: "three" },
      ]);
      const moved = await recordsTableDataset([{ input: "kept moving" }]);
      const write = objectStorage.write.bind(objectStorage);
      objectStorage.write = async (...args: Parameters<typeof write>) => {
        if (JSON.stringify(args[0]).includes(refused)) throw new Error("storage refused");
        return write(...args);
      };
      const before = await tableRows(refused);

      try {
        await expect(step()).rejects.toThrow("1 datasets failed");
      } finally {
        objectStorage.write = write;
      }

      expect(await layout(refused)).toBe("postgres");
      expect(await readRows(refused)).toEqual(["one", "two", "three"]);
      expect(await tableRows(refused)).toEqual(before);
      expect(await layout(moved)).toBe("s3_jsonl");
    });
  });

  describe("given a dataset with a row filed under another project", () => {
    it("moves the rows of its own project and reports the other one", async () => {
      const datasetId = await recordsTableDataset([
        { input: "mine" },
        { input: "misfiled", under: otherProjectId },
      ]);

      const report = await step();

      expect(await readRows(datasetId)).toEqual(["mine"]);
      expect(report).toMatchObject({
        rowsUnderOtherProject: [{ datasetId, projectId, rows: 1 }],
      });
    });
  });
});
