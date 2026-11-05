/**
 * A column edit on a Postgres-stored dataset and a record write that arrives while it runs
 * take the same dataset lock: the write waits, then is refused for naming a removed column.
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import { DatasetStaleColumnsError } from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestInlineAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetRecordRepository } from "../../repositories/dataset-record.repository.ts";
import { PrismaDatasetRecordRepository } from "../../repositories/prisma/prisma.dataset-record.repository.ts";
import { PrismaDatasetRepository } from "../../repositories/prisma/prisma.dataset.repository.ts";
import { DatasetService } from "../dataset.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

/** How long the test holds the column edit's lock while the concurrent write waits on it. */
const HOLD_MS = 300;

describe.skipIf(!DB_URL)("a column edit racing a record write", () => {
  const namespace = `dataset-concurrent-columns-${randomUUID()}`;
  const organizationId = `${namespace}-organization`;
  const teamId = `${namespace}-team`;
  const projectId = `${namespace}-project`;
  const datasetId = `${namespace}-dataset`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:dataset:test:concurrent-columns"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const real = PrismaDatasetRecordRepository.create({ prisma });

  /** Runs once, inside the first lock taken: the column edit's. */
  let insideFirstLock: (() => Promise<void>) | undefined;
  const records: DatasetRecordRepository = Object.assign(Object.create(real) as typeof real, {
    withDatasetLock: ((key, work) =>
      real.withDatasetLock(key, async (locked) => {
        const hook = insideFirstLock;
        insideFirstLock = undefined;
        if (hook) await hook();
        return work(locked);
      })) satisfies DatasetRecordRepository["withDatasetLock"],
  });
  const service = DatasetService.create({
    repository: PrismaDatasetRepository.create({ prisma }),
    records,
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(),
    inlineAttachments: createDatasetTestInlineAttachments(),
  });

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
    await prisma.dataset.create({
      data: {
        id: datasetId,
        projectId,
        name: "Support Set",
        slug: `${namespace}-support-set`,
        columnTypes: [
          { name: "input", type: "string" },
          { name: "expected_output", type: "string" },
        ],
      },
    });
    await records.createMany({
      datasetId,
      projectId,
      entries: [
        { id: `${namespace}-rec-1`, input: "How do I pay?", expected_output: "Open Billing." },
        { id: `${namespace}-rec-2`, input: "Opening hours?", expected_output: "Nine to six." },
      ],
    });
  });

  afterAll(async () => {
    await prisma.datasetRecord.deleteMany({ where: { projectId } });
    await prisma.dataset.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when a cell edit keyed by the old columns arrives during a delete plus rename", () => {
    /** @scenario "A record write that arrives during a column edit waits for it and is refused when keyed by a removed column" */
    it("waits for the edit, is refused as stale, and leaves the renamed values intact", async () => {
      let settledDuringEdit = false;
      let concurrent: Promise<unknown> | undefined;
      insideFirstLock = async () => {
        concurrent = service.updateRecord({
          projectId,
          slugOrId: datasetId,
          recordId: `${namespace}-rec-2`,
          updatedRecord: { input: "Opening hours?", expected_output: "Nine to five." },
          columns: ["input", "expected_output"],
        });
        const markSettled = () => {
          settledDuringEdit = true;
        };
        concurrent.then(markSettled, markSettled).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
        expect(settledDuringEdit).toBe(false);
      };

      await service.upsertDataset({
        projectId,
        datasetId,
        name: "Support Set",
        columnTypes: [{ name: "reference", type: "string" }],
        columnRenames: [{ from: "expected_output", to: "reference" }],
      });

      await expect(concurrent).rejects.toBeInstanceOf(DatasetStaleColumnsError);
      const stored = await records.findPage({ datasetId, projectId, limit: 10 });
      expect(stored.map((record) => record.entry)).toEqual([
        { reference: "Open Billing." },
        { reference: "Nine to six." },
      ]);
      const dataset = await prisma.dataset.findFirstOrThrow({
        where: { id: datasetId, projectId },
      });
      expect(dataset.columnTypes).toEqual([{ name: "reference", type: "string" }]);
    });
  });

  describe("when the same cell edit is re-keyed and retried after the column edit", () => {
    /** @scenario "A record write that arrives during a column edit waits for it and is refused when keyed by a removed column" */
    it("is written under the new column", async () => {
      await service.updateRecord({
        projectId,
        slugOrId: datasetId,
        recordId: `${namespace}-rec-2`,
        updatedRecord: { reference: "Nine to five." },
        columns: ["reference"],
      });

      const [, second] = await records.findPage({ datasetId, projectId, limit: 10 });
      expect(second?.entry).toEqual({ reference: "Nine to five." });
    });
  });
});
