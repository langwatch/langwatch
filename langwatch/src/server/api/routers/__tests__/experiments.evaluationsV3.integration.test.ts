/**
 * @vitest-environment node
 *
 * Integration tests for Evaluations V3 tRPC endpoints.
 * Tests the actual saveEvaluationsV3 and getEvaluationsV3BySlug endpoints.
 */
import { ExperimentType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Helper to create a valid persisted state
const createValidState = (overrides: Record<string, unknown> = {}) => ({
  name: "Test Evaluation",
  datasets: [
    {
      id: "test-data",
      name: "Test Data",
      type: "inline" as const,
      columns: [{ id: "input", name: "input", type: "string" }],
      inline: {
        columns: [{ id: "input", name: "input", type: "string" }],
        records: { input: ["hello"] },
      },
    },
  ],
  activeDatasetId: "test-data",
  evaluators: [],
  targets: [],
  ...overrides,
});

describe("Evaluations V3 Endpoints", () => {
  // Test project ID is hardcoded in getTestUser
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  const createdExperimentIds: string[] = [];

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
    // Clean up created experiments
    if (createdExperimentIds.length > 0) {
      await prisma.experiment.deleteMany({
        where: { id: { in: createdExperimentIds }, projectId },
      });
    }
  });

  describe("saveEvaluationsV3", () => {
    it("creates a new experiment with ksuid-based ID and short slug", async () => {
      const state = createValidState();

      const result = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });

      createdExperimentIds.push(result.id);

      // ID should start with eval_ (ksuid format)
      expect(result.id).toMatch(/^eval_/);
      // Slug should be the last 8 characters of the ID (shorter URL)
      expect(result.slug).toBe(result.id.slice(-8));
      expect(result.slug).toHaveLength(8);
      expect(result.name).toBe("Test Evaluation");
      expect(result.type).toBe(ExperimentType.EVALUATIONS_V3);
    });

    it("generates unique IDs and slugs for each new experiment", async () => {
      const state1 = createValidState({ name: "Experiment 1" });
      const state2 = createValidState({ name: "Experiment 2" });

      const result1 = await caller.experiments.saveEvaluationsV3({
        projectId,
        state: state1,
      });
      const result2 = await caller.experiments.saveEvaluationsV3({
        projectId,
        state: state2,
      });

      createdExperimentIds.push(result1.id, result2.id);

      // Each experiment should have a unique ID
      expect(result1.id).not.toBe(result2.id);
      // Each should have unique slugs (derived from unique IDs)
      expect(result1.slug).not.toBe(result2.slug);
      // Slugs should be 8 chars (last 8 chars of ID)
      expect(result1.slug).toHaveLength(8);
      expect(result2.slug).toHaveLength(8);
    });

    it("updates an existing experiment without changing its slug", async () => {
      // Create initial experiment
      const initialState = createValidState({ name: "Initial Name" });
      const created = await caller.experiments.saveEvaluationsV3({
        projectId,
        state: initialState,
      });
      createdExperimentIds.push(created.id);

      const originalSlug = created.slug;

      // Update the experiment with a new name
      const updatedState = createValidState({ name: "Updated Name" });
      const updated = await caller.experiments.saveEvaluationsV3({
        projectId,
        experimentId: created.id,
        state: updatedState,
      });

      // ID should remain the same
      expect(updated.id).toBe(created.id);
      // Slug should remain the same (not regenerated)
      expect(updated.slug).toBe(originalSlug);
      // Name should be updated
      expect(updated.name).toBe("Updated Name");
    });

    it("uses experimentSlug from state for new experiments when provided", async () => {
      const customSlug = "myCustom8";
      const state = createValidState({
        name: "Custom Slug Experiment",
        experimentSlug: customSlug,
      });

      const result = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });

      createdExperimentIds.push(result.id);

      // Should use the provided slug instead of generating one
      expect(result.slug).toBe(customSlug);
      // ID should be a ksuid with experiment_ prefix
      expect(result.id).toMatch(/^experiment_/);
    });

    it("saves the workbenchState correctly", async () => {
      const state = createValidState({
        name: "State Test",
        datasets: [
          {
            id: "custom-data",
            name: "Custom Data",
            type: "inline" as const,
            columns: [
              { id: "input", name: "input", type: "string" },
              { id: "output", name: "output", type: "string" },
            ],
            inline: {
              columns: [
                { id: "input", name: "input", type: "string" },
                { id: "output", name: "output", type: "string" },
              ],
              records: {
                input: ["hello", "world"],
                output: ["hi", "earth"],
              },
            },
          },
        ],
      });

      const result = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });
      createdExperimentIds.push(result.id);

      // Fetch the experiment to verify workbenchState was saved
      const saved = await prisma.experiment.findUnique({
        where: { id: result.id, projectId },
      });

      expect(saved?.workbenchState).toBeDefined();
      const workbenchState = saved?.workbenchState as Record<string, unknown>;
      expect(workbenchState.name).toBe("State Test");
      expect((workbenchState.datasets as Array<{ id: string }>)[0]?.id).toBe(
        "custom-data",
      );
    });
  });

  describe("getEvaluationsV3BySlug", () => {
    it("returns an experiment by its slug", async () => {
      // First create an experiment
      const state = createValidState({ name: "Findable Experiment" });
      const created = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });
      createdExperimentIds.push(created.id);

      // Now fetch it by slug
      const found = await caller.experiments.getEvaluationsV3BySlug({
        projectId,
        experimentSlug: created.slug,
      });

      expect(found.id).toBe(created.id);
      expect(found.slug).toBe(created.slug);
      expect(found.name).toBe("Findable Experiment");
      expect(found.workbenchState).toBeDefined();
    });

    it("throws NOT_FOUND for non-existent slug", async () => {
      await expect(
        caller.experiments.getEvaluationsV3BySlug({
          projectId,
          experimentSlug: "nonexistent-slug-12345",
        }),
      ).rejects.toThrow("Experiment not found");
    });

    it("throws BAD_REQUEST for non-EVALUATIONS_V3 experiment", async () => {
      // Create a DSPY experiment directly in the database
      const dspyExperiment = await prisma.experiment.create({
        data: {
          id: `dspy_test_${Date.now()}`,
          slug: `dspy-test-${Date.now()}`,
          name: "DSPY Experiment",
          type: ExperimentType.DSPY,
          projectId,
        },
      });
      createdExperimentIds.push(dspyExperiment.id);

      await expect(
        caller.experiments.getEvaluationsV3BySlug({
          projectId,
          experimentSlug: dspyExperiment.slug,
        }),
      ).rejects.toThrow("Experiment is not an EVALUATIONS_V3 type");
    });
  });
});
