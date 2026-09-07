/**
 * @vitest-environment node
 *
 * Integration coverage for `dataset.getAll` — the query behind the datasets
 * list page, the "Add to Dataset" picker, the command bar and the automations
 * pages — running end to end against the real Postgres.
 *
 * This pins the wiring the helper tests cannot see: that the router returns the
 * `_count.datasetRecords` shape its consumers render, with the right number for
 * each storage layout, and that another project's entries never contribute.
 *
 * Spec: specs/datasets/datasets-list-page.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { datasetDisplayRecordCount } from "~/server/datasets/record-count";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

const PROJECT_ID = "test-project-id";

describe("dataset.getAll", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  const ns = nanoid(8);
  const datasetIds: string[] = [];
  let otherProjectId: string;

  const seedDataset = async ({
    projectId,
    name,
    contentLayout = "postgres",
    useS3 = false,
    rowCount,
    s3RecordCount,
    records = 0,
  }: {
    projectId: string;
    name: string;
    contentLayout?: string;
    useS3?: boolean;
    rowCount?: number;
    s3RecordCount?: number;
    records?: number;
  }) => {
    const dataset = await prisma.dataset.create({
      data: {
        id: `dataset_${ns}_${nanoid(6)}`,
        name,
        slug: `${ns}-${nanoid(6)}`,
        projectId,
        columnTypes: [],
        contentLayout,
        useS3,
        rowCount,
        s3RecordCount,
      },
    });
    datasetIds.push(dataset.id);

    if (records > 0) {
      await prisma.datasetRecord.createMany({
        data: Array.from({ length: records }, (_, i) => ({
          id: `record_${ns}_${nanoid(6)}`,
          datasetId: dataset.id,
          projectId,
          entry: { input: `row ${i}` },
        })),
      });
    }

    return dataset;
  };

  beforeAll(async () => {
    const user = await getTestUser();
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: user.id }, expires: "1" },
      }),
    );

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: PROJECT_ID },
    });
    const otherProject = await prisma.project.create({
      data: {
        id: `project_other_${ns}`,
        name: "Neighbouring project",
        slug: `other-${ns}`,
        teamId: project.teamId,
        apiKey: `test-api-key-${ns}`,
        language: "python",
        framework: "openai",
        personalFeatures: {},
      },
    });
    otherProjectId = otherProject.id;

    // A neighbouring tenant with entries in the same table. Its rows must never
    // reach this project's counts.
    await seedDataset({
      projectId: otherProjectId,
      name: "neighbour dataset",
      records: 25,
    });
  });

  afterAll(async () => {
    // `test-project-id` is shared with every other integration suite, so each
    // entry stays pinned to the ids this suite created as well as the two
    // projects it touched — the tenancy guard requires the projectId besides.
    const projectIds = [PROJECT_ID, otherProjectId];
    await cleanupTestRows(prisma, [
      [
        "datasetRecord",
        { datasetId: { in: datasetIds }, projectId: { in: projectIds } },
      ],
      ["dataset", { id: { in: datasetIds }, projectId: { in: projectIds } }],
      ["project", { id: otherProjectId }],
    ]);
  });

  describe("given datasets across every storage layout, and a neighbouring project with entries", () => {
    describe("when listing my project's datasets", () => {
      /** @scenario "Entry counts are right whichever storage a dataset uses" */
      it("gives each dataset its own count and ignores the neighbour's entries", async () => {
        const inTable = await seedDataset({
          projectId: PROJECT_ID,
          name: `${ns} entries table`,
          records: 6,
        });
        const chunked = await seedDataset({
          projectId: PROJECT_ID,
          name: `${ns} object storage`,
          contentLayout: "s3_jsonl",
          rowCount: 4_200,
        });
        const legacyBlob = await seedDataset({
          projectId: PROJECT_ID,
          name: `${ns} legacy blob`,
          useS3: true,
          s3RecordCount: 31,
        });

        const listed = await caller.dataset.getAll({ projectId: PROJECT_ID });
        const byId = new Map(listed.map((dataset) => [dataset.id, dataset]));

        expect(datasetDisplayRecordCount(byId.get(inTable.id)!)).toBe(6);
        expect(datasetDisplayRecordCount(byId.get(chunked.id)!)).toBe(4_200);
        expect(datasetDisplayRecordCount(byId.get(legacyBlob.id)!)).toBe(31);

        // The neighbouring project's dataset is not in my list at all, and its
        // 25 entries have not inflated any row here.
        expect(
          listed.some((dataset) => dataset.name === "neighbour dataset"),
        ).toBe(false);
      });

      /** @scenario "Listing never counts another project's entries" */
      it("reports zero for an empty dataset rather than the neighbour's total", async () => {
        const empty = await seedDataset({
          projectId: PROJECT_ID,
          name: `${ns} empty`,
        });

        const listed = await caller.dataset.getAll({ projectId: PROJECT_ID });
        const found = listed.find((dataset) => dataset.id === empty.id)!;

        expect(found._count.datasetRecords).toBe(0);
        expect(datasetDisplayRecordCount(found)).toBe(0);
      });
    });
  });
});
