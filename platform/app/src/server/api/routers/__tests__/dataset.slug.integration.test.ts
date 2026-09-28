/**
 * @vitest-environment node
 *
 * A dataset's slug is minted at creation and never follows a rename.
 * Spec: specs/datasets/dataset-slug-stability.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

const PROJECT_ID = "test-project-id";
const COLUMNS = [{ name: "input", type: "string" as const }];

describe("dataset slug stability", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  const ns = nanoid(8)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "x");
  const datasetIds: string[] = [];

  const seedDataset = async ({
    name,
    slug,
  }: {
    name: string;
    slug: string;
  }) => {
    const dataset = await prisma.dataset.create({
      data: {
        id: `dataset_${ns}_${nanoid(6)}`,
        name,
        slug,
        projectId: PROJECT_ID,
        columnTypes: COLUMNS,
        contentLayout: "postgres",
      },
    });
    datasetIds.push(dataset.id);
    return dataset;
  };

  beforeAll(async () => {
    const user = await getTestUser();
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: user.id }, expires: "1" },
      }),
    );
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["dataset", { id: { in: datasetIds }, projectId: PROJECT_ID }],
    ]);
  });

  describe("when a dataset is being renamed in the edit drawer", () => {
    /** @scenario "The edit drawer shows the slug the dataset keeps" */
    it("reports the slug the dataset already has", async () => {
      const dataset = await seedDataset({
        name: `${ns} Original`,
        slug: `${ns}-original`,
      });

      const result = await caller.dataset.validateDatasetName({
        projectId: PROJECT_ID,
        proposedName: `${ns} Renamed Dataset`,
        excludeDatasetId: dataset.id,
      });

      expect(result).toEqual({
        available: true,
        slug: `${ns}-original`,
        conflictsWith: undefined,
      });
    });

    /** @scenario "The edit drawer still flags a name another dataset's slug holds" */
    it("flags a name whose slug another dataset holds", async () => {
      const alpha = await seedDataset({
        name: `${ns} Alpha`,
        slug: `${ns}-alpha`,
      });
      await seedDataset({ name: `${ns} Beta`, slug: `${ns}-beta` });

      const result = await caller.dataset.validateDatasetName({
        projectId: PROJECT_ID,
        proposedName: `${ns} Beta`,
        excludeDatasetId: alpha.id,
      });

      expect(result.available).toBe(false);
      expect(result.conflictsWith).toBe(`${ns} Beta`);
    });
  });

  describe("when a rename is saved", () => {
    /** @scenario "Saving a rename from the UI keeps the slug" */
    it("keeps the slug", async () => {
      const dataset = await seedDataset({
        name: `${ns} Saved`,
        slug: `${ns}-saved`,
      });

      const updated = await caller.dataset.upsert({
        projectId: PROJECT_ID,
        datasetId: dataset.id,
        name: `${ns} Saved Under A New Name`,
        columnTypes: COLUMNS,
      });

      expect(updated.name).toBe(`${ns} Saved Under A New Name`);
      expect(updated.slug).toBe(`${ns}-saved`);
    });
  });

  describe("when a renamed dataset is archived and the archive undone", () => {
    /** @scenario "Undoing an archive restores the slug the dataset kept" */
    it("restores the slug it kept", async () => {
      const dataset = await seedDataset({
        name: `${ns} Something Else`,
        slug: `${ns}-kept-slug`,
      });

      await caller.dataset.deleteById({
        projectId: PROJECT_ID,
        datasetId: dataset.id,
      });
      const archived = await prisma.dataset.findUniqueOrThrow({
        where: { id: dataset.id, projectId: PROJECT_ID },
      });
      expect(archived.slug).toMatch(
        new RegExp(`^${ns}-kept-slug-archived-.{21}$`),
      );

      await caller.dataset.deleteById({
        projectId: PROJECT_ID,
        datasetId: dataset.id,
        undo: true,
      });
      const restored = await prisma.dataset.findUniqueOrThrow({
        where: { id: dataset.id, projectId: PROJECT_ID },
      });
      expect(restored.slug).toBe(`${ns}-kept-slug`);
      expect(restored.archivedAt).toBeNull();
    });
  });
});
