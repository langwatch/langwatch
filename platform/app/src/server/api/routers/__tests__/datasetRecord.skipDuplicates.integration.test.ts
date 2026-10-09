import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { createManyDatasetRecords } from "../datasetRecord.utils";

/**
 * Re-adding rows with the same ids against a real Postgres.
 *
 * Spec: specs/automations/process-manager-dispatch.feature
 */
describe("createManyDatasetRecords duplicate ids (integration)", () => {
  const ns = nanoid();
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let datasetId: string;

  const rowsFor = (ids: string[]) =>
    ids.map((id) => ({ id, input: `input ${id}` }));

  const countRows = (id: string) =>
    prisma.datasetRecord.count({ where: { id, datasetId, projectId } });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Dup Org", slug: `dup-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "Dup Team", slug: `dup-team-${ns}`, organizationId },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `dup-${ns}` }),
        teamId,
        personalFeatures: {},
      },
    });
    projectId = project.id;
  });

  const newDataset = async () => {
    const dataset = await prisma.dataset.create({
      data: {
        id: `dataset_${nanoid()}`,
        name: "dup",
        slug: `dup-${nanoid()}`,
        projectId,
        columnTypes: [],
        contentLayout: "postgres",
        useS3: false,
      },
    });
    datasetId = dataset.id;
  };

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["datasetRecord", { projectId }],
      ["dataset", { projectId }],
      ["project", { id: projectId }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("given rows that already exist in a Postgres dataset", () => {
    describe("when the same ids are added again with skipDuplicates", () => {
      let ids: string[];
      let result: Promise<unknown>;

      beforeAll(async () => {
        await newDataset();
        ids = [`trigger-${nanoid()}-0`, `trigger-${nanoid()}-1`];
        await createManyDatasetRecords({
          datasetId,
          projectId,
          datasetRecords: rowsFor(ids),
        });
        result = createManyDatasetRecords({
          datasetId,
          projectId,
          datasetRecords: rowsFor(ids),
          skipDuplicates: true,
        });
        await result.catch(() => undefined);
      });

      /** @scenario "A dataset row that already exists counts as added" */
      it("resolves without error", async () => {
        await expect(result).resolves.toBeDefined();
      });

      it("keeps one copy of the first row", async () => {
        expect(await countRows(ids[0]!)).toBe(1);
      });

      it("keeps one copy of the second row", async () => {
        expect(await countRows(ids[1]!)).toBe(1);
      });
    });

    describe("when a batch mixes existing and new ids with skipDuplicates", () => {
      it("inserts the new row", async () => {
        await newDataset();
        const existing = `trigger-${nanoid()}-0`;
        const fresh = `trigger-${nanoid()}-1`;
        await createManyDatasetRecords({
          datasetId,
          projectId,
          datasetRecords: rowsFor([existing]),
        });

        await createManyDatasetRecords({
          datasetId,
          projectId,
          datasetRecords: rowsFor([existing, fresh]),
          skipDuplicates: true,
        });

        expect(await countRows(fresh)).toBe(1);
      });
    });

    describe("when a retry adds a grown batch with skipDuplicates", () => {
      let a: string;
      let b: string;
      let c: string;
      let result: Promise<unknown>;

      const entryOf = async (id: string) =>
        (
          await prisma.datasetRecord.findFirst({
            where: { id, datasetId, projectId },
          })
        )?.entry;

      beforeAll(async () => {
        await newDataset();
        a = `trigger-${nanoid()}-0`;
        b = `trigger-${nanoid()}-1`;
        c = `trigger-${nanoid()}-2`;
        await createManyDatasetRecords({
          datasetId,
          projectId,
          datasetRecords: [
            { id: a, input: "original a" },
            { id: b, input: "original b" },
          ],
        });
        result = createManyDatasetRecords({
          datasetId,
          projectId,
          datasetRecords: [
            { id: a, input: "changed a" },
            { id: b, input: "original b" },
            { id: c, input: "new c" },
          ],
          skipDuplicates: true,
        });
        await result.catch(() => undefined);
      });

      it("resolves without error", async () => {
        await expect(result).resolves.toBeDefined();
      });

      it("leaves the first row with its original content", async () => {
        expect(await entryOf(a)).toMatchObject({ input: "original a" });
      });

      it("leaves the second row unchanged", async () => {
        expect(await entryOf(b)).toMatchObject({ input: "original b" });
      });

      it("adds the missing row", async () => {
        expect(await entryOf(c)).toMatchObject({ input: "new c" });
      });
    });

    describe("when the same ids are added again without skipDuplicates", () => {
      it("rejects, keeping upload semantics", async () => {
        await newDataset();
        const ids = [`upload-${nanoid()}-0`];
        await createManyDatasetRecords({
          datasetId,
          projectId,
          datasetRecords: rowsFor(ids),
        });

        await expect(
          createManyDatasetRecords({
            datasetId,
            projectId,
            datasetRecords: rowsFor(ids),
          }),
        ).rejects.toMatchObject({ code: "P2002" });
      });
    });
  });
});
