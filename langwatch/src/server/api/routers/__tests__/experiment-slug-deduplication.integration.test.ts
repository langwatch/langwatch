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
import { ExperimentService } from "../../../experiments/experiment.service";

globalForApp.__langwatch_app = createTestApp();

describe("Feature: Experiment slug deduplication", () => {
  const projectId = "test-project-id";
  const createdExperimentIds: string[] = [];
  const service = ExperimentService.create(prisma);
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

  describe("ExperimentService.generateUniqueSlug()", () => {
    describe("when no conflicting slug exists", () => {
      it("returns the base slug unchanged", async () => {
        const uniqueBase = `no-conflict-${nanoid(8)}`;
        const result = await service.generateUniqueSlug({
          baseSlug: uniqueBase,
          projectId,
        });

        expect(result).toBe(uniqueBase);
      });
    });

    describe("given an experiment exists with slug 'my-experiment'", () => {
      let existingSlug: string;
      let existingExperimentId: string;

      beforeAll(async () => {
        existingSlug = `my-experiment-${nanoid(6)}`;
        existingExperimentId = await createExperimentWithSlug(existingSlug);
      });

      describe("when a new experiment generates the same slug", () => {
        it("gets deduplicated slug with -2 suffix", async () => {
          const result = await service.generateUniqueSlug({
            baseSlug: existingSlug,
            projectId,
          });

          expect(result).toBe(`${existingSlug}-2`);
        });
      });

      describe("when the same experiment is updated with the same slug", () => {
        it("retains the original slug unchanged", async () => {
          const result = await service.generateUniqueSlug({
            baseSlug: existingSlug,
            projectId,
            excludeExperimentId: existingExperimentId,
          });

          expect(result).toBe(existingSlug);
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
        it("increments to -3 suffix", async () => {
          const result = await service.generateUniqueSlug({
            baseSlug,
            projectId,
          });

          expect(result).toBe(`${baseSlug}-3`);
        });
      });
    });

    describe("when an unrelated slug shares the same prefix", () => {
      const baseSlug = `my-exp-${nanoid(6)}`;

      beforeAll(async () => {
        // Create an unrelated experiment whose slug starts with baseSlug
        // but is a different word (e.g., "my-exp-abc123-extended")
        await createExperimentWithSlug(`${baseSlug}-extended`);
      });

      it("does not treat the unrelated slug as a conflict", async () => {
        const result = await service.generateUniqueSlug({
          baseSlug,
          projectId,
        });

        expect(result).toBe(baseSlug);
      });
    });
  });

  describe("saveEvaluationsV3()", () => {
    describe("given an experiment exists with a specific slug", () => {
      const sharedName = `Regression 977 ${nanoid(6)}`;
      let firstExperimentId: string;
      let firstSlug: string;

      beforeAll(async () => {
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

        const experiment = await prisma.experiment.findUnique({
          where: { id: firstExperimentId, projectId },
        });
        firstSlug = experiment!.slug;
      });

      describe("when a new experiment is saved with the same name", () => {
        it("gets deduplicated slug without P2002 error", async () => {
          const result = await caller.experiments.saveEvaluationsV3({
            projectId,
            state: {
              name: sharedName,
              experimentSlug: firstSlug,
              datasets: [],
              activeDatasetId: "dummy",
              evaluators: [],
              targets: [],
            },
          });

          createdExperimentIds.push(result.id);

          expect(result.slug).toBe(`${firstSlug}-2`);
        });
      });

      describe("when the same experiment is updated with the same name", () => {
        it("retains the original slug unchanged", async () => {
          const result = await caller.experiments.saveEvaluationsV3({
            projectId,
            experimentId: firstExperimentId,
            state: {
              name: sharedName,
              experimentSlug: firstSlug,
              datasets: [],
              activeDatasetId: "dummy",
              evaluators: [],
              targets: [],
            },
          });

          expect(result.slug).toBe(firstSlug);
        });
      });
    });
  });
});
