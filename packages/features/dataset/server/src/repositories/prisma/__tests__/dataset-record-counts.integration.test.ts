/**
 * How a dataset list counts its entries, against real Postgres.
 *
 * The behaviour is not only "the number is right" — it is WHAT the database is
 * asked to read to produce it. Prisma's relation-count `include` returns
 * correct numbers while aggregating the whole `DatasetRecord` table across
 * every tenant, so a correctness-only test passes on the slow path and the fast
 * one alike. The guard the connection is opened with records every query the
 * repository issues, which is what tells the two apart.
 *
 * @see specs/datasets/datasets-list-page.feature
 */
import { datasetDisplayRecordCount } from "@langwatch/dataset-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaDatasetContentRepository } from "../prisma.dataset-content.repository";

/** Every query the repository issued, in order, with the arguments it sent. */
class RecordingGuard extends PrismaQueryGuard {
  readonly contexts: PrismaQueryContext[] = [];

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    this.contexts.push(context);

    return next(context.args);
  }
}

const DB_URL = process.env.DATABASE_URL;
const suffix = nanoid(8);
const ORGANIZATION_ID = `org_dataset_counts_${suffix}`;
const TEAM_ID = `team_dataset_counts_${suffix}`;
const PROJECT_ID = `proj_dataset_counts_${suffix}`;
const OTHER_PROJECT_ID = `proj_dataset_counts_other_${suffix}`;

const guard = new RecordingGuard();
const connection = DB_URL
  ? PrismaConnectionService.create({ guard }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }),
    )
  : null;

const database = (): PrismaClient => {
  if (!connection) throw new Error("DATABASE_URL is required for the dataset count suite");

  return connection.client;
};

const datasets = () => PrismaDatasetContentRepository.create(database());

/** The reads that touched the entries table since the last arrangement. */
const entryReads = (): PrismaQueryContext[] =>
  guard.contexts.filter((context) => context.model === "DatasetRecord");

const createDataset = async ({
  projectId = PROJECT_ID,
  name,
  contentLayout = "postgres",
  useS3 = false,
  rowCount,
  s3RecordCount,
  records = 0,
}: {
  projectId?: string;
  name: string;
  contentLayout?: string;
  useS3?: boolean;
  rowCount?: number;
  s3RecordCount?: number;
  records?: number;
}): Promise<{ id: string }> => {
  const dataset = await database().dataset.create({
    data: {
      id: `dataset_${nanoid(10)}`,
      name,
      slug: `${name}-${nanoid(6)}`,
      projectId,
      columnTypes: [],
      contentLayout,
      useS3,
      ...(rowCount === undefined ? {} : { rowCount }),
      ...(s3RecordCount === undefined ? {} : { s3RecordCount }),
    },
  });

  if (records > 0) {
    await database().datasetRecord.createMany({
      data: Array.from({ length: records }, (_, index) => ({
        id: `record_${nanoid(10)}`,
        datasetId: dataset.id,
        projectId,
        entry: { input: `row ${index}` },
      })),
    });
  }

  return { id: dataset.id };
};

/** The list the page renders, over exactly the datasets a scenario created. */
const listed = async (): Promise<
  Array<{ id: string; _count: { datasetRecords: number }; contentLayout?: string | null }>
> => {
  const page = await datasets().listPaginated({ projectId: PROJECT_ID, skip: 0, take: 50 });

  return page.datasets;
};

describe.skipIf(!DB_URL)("dataset entry counts", () => {
  beforeAll(async () => {
    const db = database();
    await db.organization.create({
      data: { id: ORGANIZATION_ID, name: ORGANIZATION_ID, slug: ORGANIZATION_ID },
    });
    await db.team.create({
      data: { id: TEAM_ID, name: TEAM_ID, slug: TEAM_ID, organizationId: ORGANIZATION_ID },
    });
    for (const id of [PROJECT_ID, OTHER_PROJECT_ID]) {
      await db.project.create({
        data: {
          id,
          name: id,
          slug: id,
          teamId: TEAM_ID,
          language: "typescript",
          framework: "other",
          apiKey: `key-${id}`,
        },
      });
    }

    // The rest of the platform's data. If counting is not tenant-scoped, this
    // is what a customer's own list ends up paying for.
    await createDataset({
      projectId: OTHER_PROJECT_ID,
      name: "someone-elses-dataset",
      records: 40,
    });
  });

  beforeEach(async () => {
    const db = database();
    await db.datasetRecord.deleteMany({ where: { projectId: PROJECT_ID } });
    await db.dataset.deleteMany({ where: { projectId: PROJECT_ID } });
    guard.contexts.length = 0;
  });

  afterAll(async () => {
    try {
      const db = database();
      await db.datasetRecord.deleteMany({
        where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
      });
      await db.dataset.deleteMany({
        where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
      });
      await db.project.deleteMany({ where: { id: { in: [PROJECT_ID, OTHER_PROJECT_ID] } } });
      await db.team.deleteMany({ where: { id: TEAM_ID } });
      await db.organization.deleteMany({ where: { id: ORGANIZATION_ID } });
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given another project holds far more dataset entries than mine", () => {
    describe("when my project's datasets are counted", () => {
      /** @scenario "Listing never counts another project's entries" */
      it("reads my own project's entries only", async () => {
        const mine = await createDataset({ name: "mine", records: 3 });
        guard.contexts.length = 0;

        const page = await listed();

        expect(page.find((dataset) => dataset.id === mine.id)?._count.datasetRecords).toBe(3);
        // One read of the entries table, and it names the project. A read
        // without a `projectId` predicate is reading every tenant's rows,
        // whatever number it ends up returning.
        const reads = entryReads();
        expect(reads).toHaveLength(1);
        expect(reads[0]?.args).toMatchObject({ where: { projectId: PROJECT_ID } });
      });
    });
  });

  describe("given every dataset in my project is kept in object storage", () => {
    describe("when they are counted", () => {
      /** @scenario "Datasets kept in object storage report their count without reading entries" */
      it("reports the stored count without reading the entries table at all", async () => {
        const chunked = await createDataset({
          name: "chunked",
          contentLayout: "s3_jsonl",
          rowCount: 5_000,
        });
        const legacy = await createDataset({ name: "legacy-blob", useS3: true, s3RecordCount: 77 });
        guard.contexts.length = 0;

        const page = await listed();
        const countOf = (id: string) =>
          datasetDisplayRecordCount(page.find((dataset) => dataset.id === id)!);

        expect(entryReads()).toHaveLength(0);
        expect([countOf(chunked.id), countOf(legacy.id)]).toEqual([5_000, 77]);
      });
    });
  });

  describe("given my project mixes entries-table datasets with object-storage ones", () => {
    describe("when they are counted", () => {
      /** @scenario "Entry counts are right whichever storage a dataset uses" */
      it("gives every dataset its own count, in one read for the page", async () => {
        const inTable = await createDataset({ name: "in-table", records: 4 });
        const alsoInTable = await createDataset({ name: "also-in-table", records: 9 });
        const empty = await createDataset({ name: "empty" });
        const chunked = await createDataset({
          name: "chunked-mixed",
          contentLayout: "s3_jsonl",
          rowCount: 12_345,
        });
        guard.contexts.length = 0;

        const page = await listed();
        const countOf = (id: string) =>
          datasetDisplayRecordCount(page.find((dataset) => dataset.id === id)!);

        expect([
          countOf(inTable.id),
          countOf(alsoInTable.id),
          countOf(empty.id),
          countOf(chunked.id),
        ]).toEqual([4, 9, 0, 12_345]);
        // One round trip for the whole page, not one per dataset.
        expect(entryReads()).toHaveLength(1);
      });
    });
  });
});
