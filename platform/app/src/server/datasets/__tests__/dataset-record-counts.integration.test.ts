import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { attachDatasetRecordCounts } from "../dataset-record-counts";
import { datasetDisplayRecordCount } from "../record-count";

/**
 * Integration coverage for how dataset lists count entries, against a real
 * Postgres.
 *
 * The behaviour under test is not just "the number is right" — it is *what the
 * database is asked to read to produce it*. Prisma's relation-count `include`
 * returns correct numbers while aggregating the whole `DatasetRecord` table
 * across every tenant, so a correctness-only test passes on the slow path and
 * the fast path alike. These tests therefore capture the SQL actually issued
 * and assert on its shape, which is the only thing that distinguishes them.
 *
 * Spec: specs/datasets/datasets-list-page.feature
 */
describe("dataset entry counts (integration)", () => {
  const ns = nanoid();
  let queryLoggingPrisma: PrismaClient;

  // Two tenants: `project` is the one whose list we render, `otherProject`
  // stands in for the rest of the platform's data.
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let otherProjectId: string;

  const captured: string[] = [];
  const recordQueries = () =>
    captured.filter((sql) => sql.includes('"DatasetRecord"'));

  const createDataset = async ({
    project,
    name,
    contentLayout = "postgres",
    useS3 = false,
    rowCount,
    s3RecordCount,
    records = 0,
  }: {
    project: string;
    name: string;
    contentLayout?: string;
    useS3?: boolean;
    rowCount?: number;
    s3RecordCount?: number;
    records?: number;
  }) => {
    const dataset = await prisma.dataset.create({
      data: {
        id: `dataset_${nanoid()}`,
        name,
        slug: `${name}-${nanoid()}`,
        projectId: project,
        columnTypes: [],
        contentLayout,
        useS3,
        rowCount,
        s3RecordCount,
      },
    });

    if (records > 0) {
      await prisma.datasetRecord.createMany({
        data: Array.from({ length: records }, (_, i) => ({
          id: `record_${nanoid()}`,
          datasetId: dataset.id,
          projectId: project,
          entry: { input: `row ${i}` },
        })),
      });
    }

    return dataset;
  };

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Count Org", slug: `count-org-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: "Count Team",
        slug: `count-team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `count-${ns}` }),
        teamId,
        personalFeatures: {},
      },
    });
    projectId = project.id;

    const otherProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `count-other-${ns}` }),
        teamId,
        personalFeatures: {},
      },
    });
    otherProjectId = otherProject.id;

    // The rest of the platform's data. If counting is not tenant-scoped, this
    // is what a customer's list ends up paying for.
    await createDataset({
      project: otherProjectId,
      name: "someone elses dataset",
      records: 40,
    });

    queryLoggingPrisma = new PrismaClient({
      log: [{ emit: "event", level: "query" }],
    });
    queryLoggingPrisma.$on("query" as never, (event: { query: string }) => {
      captured.push(event.query);
    });
  });

  afterAll(async () => {
    await queryLoggingPrisma?.$disconnect();
    await cleanupTestRows(prisma, [
      ["datasetRecord", { projectId: { in: [projectId, otherProjectId] } }],
      ["dataset", { projectId: { in: [projectId, otherProjectId] } }],
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]);
  });

  const countFor = async (datasets: { id: string }[]) => {
    captured.length = 0;
    return await attachDatasetRecordCounts({
      prisma: queryLoggingPrisma,
      projectId,
      datasets: datasets as Parameters<
        typeof attachDatasetRecordCounts
      >[0]["datasets"],
    });
  };

  describe("given another project holds far more dataset entries than mine", () => {
    describe("when counting my project's datasets", () => {
      /** @scenario "Listing never counts another project's entries" */
      it("reads only my own project's entries", async () => {
        const mine = await createDataset({
          project: projectId,
          name: "mine",
          records: 3,
        });

        const counted = await countFor([mine]);

        expect(counted[0]!._count.datasetRecords).toBe(3);

        // The count must be constrained to this project. A query that reads
        // `DatasetRecord` without a projectId predicate is reading every
        // tenant's rows, whatever number it ends up returning.
        const queries = recordQueries();
        expect(queries).toHaveLength(1);
        expect(queries[0]).toContain('"projectId"');
        expect(queries[0]).not.toMatch(/WHERE\s+1=1/i);
      });
    });
  });

  describe("given every dataset in my project is stored in object storage", () => {
    describe("when counting them", () => {
      /** @scenario "Datasets kept in object storage report their count without reading entries" */
      it("reports the stored count without querying the entries table", async () => {
        const chunked = await createDataset({
          project: projectId,
          name: "chunked",
          contentLayout: "s3_jsonl",
          rowCount: 5_000,
        });
        const legacyBlob = await createDataset({
          project: projectId,
          name: "legacy blob",
          useS3: true,
          s3RecordCount: 77,
        });

        const counted = await countFor([chunked, legacyBlob]);

        expect(recordQueries()).toHaveLength(0);
        expect(
          counted.map((dataset) => datasetDisplayRecordCount(dataset)),
        ).toEqual([5_000, 77]);
      });
    });
  });

  describe("given my project mixes entries-table datasets with object-storage ones", () => {
    describe("when counting them", () => {
      /** @scenario "Entry counts are right whichever storage a dataset uses" */
      it("gives every dataset its own entry count", async () => {
        const inTable = await createDataset({
          project: projectId,
          name: "in table",
          records: 4,
        });
        const alsoInTable = await createDataset({
          project: projectId,
          name: "also in table",
          records: 9,
        });
        const empty = await createDataset({
          project: projectId,
          name: "empty",
          records: 0,
        });
        const chunked = await createDataset({
          project: projectId,
          name: "chunked mixed",
          contentLayout: "s3_jsonl",
          rowCount: 12_345,
        });

        const counted = await countFor([inTable, alsoInTable, empty, chunked]);

        expect(
          counted.map((dataset) => datasetDisplayRecordCount(dataset)),
        ).toEqual([4, 9, 0, 12_345]);

        // One round trip for the whole page, not one per dataset.
        expect(recordQueries()).toHaveLength(1);
      });
    });
  });
});
