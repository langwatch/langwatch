/**
 * @vitest-environment node
 *
 * Regression tests for experiment slug deduplication.
 *
 * Issue #977: When saving an experiment, if the generated slug conflicts with
 * an existing experiment's slug in the same project, the upsert fails with a
 * unique constraint violation on (projectId, slug).
 *
 * These tests exercise the actual router mutations to verify the fix prevents
 * the Prisma unique constraint error at runtime.
 */
import { ExperimentType } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { prisma } from "../../../db";
import { generateUniqueExperimentSlug } from "../experiments";

globalForApp.__langwatch_app = createTestApp();

describe("Feature: Experiment slug deduplication", () => {
  const projectId = "test-project-id";
  const createdExperimentIds: string[] = [];
  let caller: ReturnType<typeof appRouter.createCaller>;

  /**
   * Helper to create an experiment directly in the database with a specific slug.
   */
  const createExperimentWithSlug = async (slug: string) => {
    const id = `experiment_${nanoid()}`;
    await prisma.experiment.create({
      data: {
        id,
        name: slug,
        slug,
        projectId,
        type: ExperimentType.BATCH_EVALUATION_V2,
      },
    });
    createdExperimentIds.push(id);
    return id;
  };

  beforeAll(async () => {
    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    if (createdExperimentIds.length > 0) {
      await prisma.experiment.deleteMany({
        where: { id: { in: createdExperimentIds }, projectId },
      });
    }
  });

  describe("generateUniqueExperimentSlug()", () => {
    describe("when no conflicting slug exists", () => {
      it("returns the base slug unchanged", async () => {
        const uniqueBase = `no-conflict-${nanoid(8)}`;
        const result = await generateUniqueExperimentSlug({
          baseSlug: uniqueBase,
          projectId,
          prisma,
        });

        expect(result).toBe(uniqueBase);
      });
    });

    describe("given an experiment exists with slug 'my-experiment'", () => {
      let existingExperimentId: string;

      beforeAll(async () => {
        existingExperimentId = await createExperimentWithSlug(
          `my-experiment-${nanoid(6)}`
        );
      });

      describe("when a new experiment generates the same slug", () => {
        it("appends -2 suffix to avoid the constraint violation", async () => {
          // Use the exact slug of the existing experiment
          const existingExperiment = await prisma.experiment.findUnique({
            where: { id: existingExperimentId, projectId },
          });
          const conflictingSlug = existingExperiment!.slug;

          const result = await generateUniqueExperimentSlug({
            baseSlug: conflictingSlug,
            projectId,
            prisma,
          });

          expect(result).toBe(`${conflictingSlug}-2`);
        });
      });

      describe("when updating the same experiment with the same slug", () => {
        it("returns the base slug unchanged (excludes self)", async () => {
          const existingExperiment = await prisma.experiment.findUnique({
            where: { id: existingExperimentId, projectId },
          });
          const slug = existingExperiment!.slug;

          const result = await generateUniqueExperimentSlug({
            baseSlug: slug,
            projectId,
            prisma,
            excludeExperimentId: existingExperimentId,
          });

          expect(result).toBe(slug);
        });
      });
    });

    describe("given experiments exist with slugs 'test-slug' and 'test-slug-2'", () => {
      const baseSlug = `test-slug-${nanoid(6)}`;

      beforeAll(async () => {
        await createExperimentWithSlug(baseSlug);
        await createExperimentWithSlug(`${baseSlug}-2`);
      });

      describe("when a new experiment generates the same base slug", () => {
        it("skips to -3 suffix", async () => {
          const result = await generateUniqueExperimentSlug({
            baseSlug,
            projectId,
            prisma,
          });

          expect(result).toBe(`${baseSlug}-3`);
        });
      });
    });
  });

  describe("saveEvaluationsV3 router mutation", () => {
    describe("given an experiment exists with a specific slug", () => {
      const sharedName = `Regression 977 ${nanoid(6)}`;
      let firstExperimentId: string;

      beforeAll(async () => {
        // Create the first experiment via the real router mutation
        const result = await caller.experiments.saveEvaluationsV3({
          projectId,
          state: {
            name: sharedName,
            datasets: [],
            activeDatasetId: "dummy",
            evaluators: [],
            targets: [],
          },
        });
        firstExperimentId = result.id;
        createdExperimentIds.push(firstExperimentId);
      });

      describe("when a new experiment is saved with the same name", () => {
        it("deduplicates the slug without P2002 error", async () => {
          const result = await caller.experiments.saveEvaluationsV3({
            projectId,
            state: {
              name: sharedName,
              experimentSlug: (
                await prisma.experiment.findUnique({
                  where: { id: firstExperimentId, projectId },
                })
              )!.slug,
              datasets: [],
              activeDatasetId: "dummy",
              evaluators: [],
              targets: [],
            },
          });

          createdExperimentIds.push(result.id);

          const first = await prisma.experiment.findUnique({
            where: { id: firstExperimentId, projectId },
          });

          expect(result.slug).toBe(`${first!.slug}-2`);
          expect(result.slug).not.toBe(first!.slug);
        });
      });
    });
  });
});
