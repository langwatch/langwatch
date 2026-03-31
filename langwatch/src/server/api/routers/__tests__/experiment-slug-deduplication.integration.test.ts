/**
 * @vitest-environment node
 *
 * Regression tests for experiment slug deduplication.
 *
 * Issue #977: When saving an experiment, if the generated slug conflicts with
 * an existing experiment's slug in the same project, the upsert fails with a
 * unique constraint violation on (projectId, slug).
 *
 * These tests exercise the actual database to verify the fix prevents the
 * Prisma unique constraint error at runtime.
 */
import { ExperimentType } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../db";
import { generateUniqueExperimentSlug } from "../experiments";

describe("Feature: Experiment slug deduplication", () => {
  const projectId = "test-project-id";
  const createdExperimentIds: string[] = [];

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
          });

          expect(result).toBe(`${baseSlug}-3`);
        });
      });
    });

    describe("given the slug conflict triggers an actual database upsert", () => {
      it("does not throw a unique constraint violation", async () => {
        // This is the exact scenario from issue #977:
        // 1. Create an experiment with a known slug
        // 2. Try to create a second experiment that would generate the same slug
        // 3. Without the fix, this would throw P2002 (unique constraint violation)
        const sharedSlug = `regression-977-${nanoid(6)}`;
        const firstId = await createExperimentWithSlug(sharedSlug);

        // Generate a unique slug for the second experiment
        const uniqueSlug = await generateUniqueExperimentSlug({
          baseSlug: sharedSlug,
          projectId,
        });

        // Now create the second experiment with the deduplicated slug
        const secondId = `experiment_${nanoid()}`;
        createdExperimentIds.push(secondId);

        // This upsert must NOT throw a unique constraint violation
        await expect(
          prisma.experiment.upsert({
            where: { id: secondId, projectId },
            update: {
              name: "Second Experiment",
              slug: uniqueSlug,
              projectId,
              type: ExperimentType.BATCH_EVALUATION_V2,
            },
            create: {
              id: secondId,
              name: "Second Experiment",
              slug: uniqueSlug,
              projectId,
              type: ExperimentType.BATCH_EVALUATION_V2,
            },
          })
        ).resolves.toBeDefined();

        // Verify both experiments exist with different slugs
        const first = await prisma.experiment.findUnique({
          where: { id: firstId, projectId },
        });
        const second = await prisma.experiment.findUnique({
          where: { id: secondId, projectId },
        });

        expect(first!.slug).toBe(sharedSlug);
        expect(second!.slug).toBe(`${sharedSlug}-2`);
        expect(first!.slug).not.toBe(second!.slug);
      });
    });
  });
});
