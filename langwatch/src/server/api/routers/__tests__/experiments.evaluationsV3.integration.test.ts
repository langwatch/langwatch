/**
 * @vitest-environment node
 *
 * Integration tests for Evaluations V3 tRPC endpoints.
 * Tests the actual saveEvaluationsV3 and getEvaluationsV3BySlug endpoints.
 */
import { ExperimentType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Mock license enforcement to avoid limits during tests
vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn(),
  };
});

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

      // ID should start with experiment_ prefix
      expect(result.id).toMatch(/^experiment_/);
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

  describe("copy (EVALUATIONS_V3)", () => {
    // Target project for copy tests
    const targetProjectId = "test-project-copy-target";
    const createdDatasetIds: string[] = [];

    beforeAll(async () => {
      // Get the test user and their team
      const user = await getTestUser();
      const teamUser = await prisma.teamUser.findFirst({
        where: { userId: user.id },
        include: { team: true },
      });

      if (!teamUser) {
        throw new Error("Test user must have a team");
      }

      // Create target project in the same team (for permission)
      const targetProjectExists = await prisma.project.findUnique({
        where: { id: targetProjectId },
      });
      if (!targetProjectExists) {
        await prisma.project.create({
          data: {
            id: targetProjectId,
            name: "Copy Target Project",
            slug: "copy-target-project",
            apiKey: "test-api-key-copy-target",
            teamId: teamUser.team.id,
            language: "en",
            framework: "test-framework",
          },
        });
      }
    });

    afterAll(async () => {
      // Clean up target project experiments
      await prisma.experiment.deleteMany({
        where: { projectId: targetProjectId },
      });
      // Clean up created datasets (need to specify projectId for each)
      for (const datasetId of createdDatasetIds) {
        // Try to delete from both projects since datasets may be in either
        await prisma.datasetRecord.deleteMany({
          where: { datasetId, projectId },
        });
        await prisma.datasetRecord.deleteMany({
          where: { datasetId, projectId: targetProjectId },
        });
        await prisma.dataset.deleteMany({
          where: { id: datasetId, projectId },
        });
        await prisma.dataset.deleteMany({
          where: { id: datasetId, projectId: targetProjectId },
        });
      }
    });

    it("copies a V3 experiment with inline dataset to another project", async () => {
      // Create source experiment with inline dataset
      const state = createValidState({
        name: "Copyable Experiment",
        datasets: [
          {
            id: "inline-data",
            name: "Inline Data",
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
        activeDatasetId: "inline-data",
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/basic/word_count",
            name: "Word Count",
            inputs: [{ identifier: "input", type: "str" }],
            mappings: {
              "inline-data": {
                "target-1": {
                  input: {
                    type: "source",
                    source: "target",
                    sourceId: "target-1",
                    sourceField: "output",
                  },
                },
              },
            },
          },
        ],
        targets: [
          {
            id: "target-1",
            type: "prompt" as const,
            name: "Test Prompt",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              "inline-data": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "inline-data",
                  sourceField: "input",
                },
              },
            },
          },
        ],
      });

      const created = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });
      createdExperimentIds.push(created.id);

      // Copy to target project
      const result = await caller.experiments.copy({
        experimentId: created.id,
        projectId: targetProjectId,
        sourceProjectId: projectId,
        copyDatasets: false,
      });

      expect(result.experiment).toBeDefined();
      expect(result.experiment.projectId).toBe(targetProjectId);
      expect(result.experiment.name).toBe("Copyable Experiment");
      expect(result.experiment.type).toBe(ExperimentType.EVALUATIONS_V3);

      // Verify workbenchState was copied correctly
      const copiedState = result.experiment.workbenchState as Record<
        string,
        unknown
      >;
      expect(copiedState.name).toBe("Copyable Experiment");

      // Verify datasets were copied
      const datasets = copiedState.datasets as Array<{
        id: string;
        type: string;
        inline?: { records: { input: string[] } };
      }>;
      expect(datasets).toHaveLength(1);
      expect(datasets[0]?.type).toBe("inline");
      expect(datasets[0]?.inline?.records.input).toEqual(["hello", "world"]);

      // Verify evaluators were copied
      const evaluators = copiedState.evaluators as Array<{ id: string }>;
      expect(evaluators).toHaveLength(1);

      // Verify targets were copied
      const targets = copiedState.targets as Array<{ id: string }>;
      expect(targets).toHaveLength(1);

      // Verify results were cleared
      expect(copiedState.results).toBeUndefined();
    });

    it("copies a V3 experiment with saved dataset and creates a new dataset in target project", async () => {
      // First create a saved dataset in source project
      const timestamp = Date.now();
      const sourceDataset = await prisma.dataset.create({
        data: {
          id: `dataset_copy_test_${timestamp}`,
          name: "Source Dataset",
          slug: `source-dataset-${timestamp}`,
          projectId,
          columnTypes: [
            { name: "question", type: "string" },
            { name: "answer", type: "string" },
          ],
        },
      });
      createdDatasetIds.push(sourceDataset.id);

      // Add some records to the dataset
      await prisma.datasetRecord.createMany({
        data: [
          {
            id: `record_1_${Date.now()}`,
            datasetId: sourceDataset.id,
            projectId,
            entry: {
              question: "What is AI?",
              answer: "Artificial Intelligence",
            },
          },
          {
            id: `record_2_${Date.now()}`,
            datasetId: sourceDataset.id,
            projectId,
            entry: { question: "What is ML?", answer: "Machine Learning" },
          },
        ],
      });

      // Create source experiment with saved dataset reference
      const state = createValidState({
        name: "Experiment with Saved Dataset",
        datasets: [
          {
            id: "saved-ref",
            name: "Source Dataset",
            type: "saved" as const,
            datasetId: sourceDataset.id,
            columns: [
              { id: "question", name: "question", type: "string" },
              { id: "answer", name: "answer", type: "string" },
            ],
          },
        ],
        activeDatasetId: "saved-ref",
      });

      const created = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });
      createdExperimentIds.push(created.id);

      // Copy to target project WITH dataset copying enabled
      const result = await caller.experiments.copy({
        experimentId: created.id,
        projectId: targetProjectId,
        sourceProjectId: projectId,
        copyDatasets: true,
      });

      expect(result.experiment).toBeDefined();
      expect(result.experiment.projectId).toBe(targetProjectId);

      // Verify workbenchState was copied
      const copiedState = result.experiment.workbenchState as Record<
        string,
        unknown
      >;
      const datasets = copiedState.datasets as Array<{
        id: string;
        type: string;
        datasetId?: string;
      }>;

      expect(datasets).toHaveLength(1);
      expect(datasets[0]?.type).toBe("saved");
      // The datasetId should be updated to the new copied dataset
      expect(datasets[0]?.datasetId).toBeDefined();
      expect(datasets[0]?.datasetId).not.toBe(sourceDataset.id);

      // Verify the new dataset was created in target project
      const newDataset = await prisma.dataset.findFirst({
        where: { id: datasets[0]?.datasetId, projectId: targetProjectId },
      });
      expect(newDataset).toBeDefined();
      expect(newDataset?.projectId).toBe(targetProjectId);
      createdDatasetIds.push(newDataset!.id);

      // Verify records were copied
      const newRecords = await prisma.datasetRecord.findMany({
        where: { datasetId: newDataset!.id, projectId: targetProjectId },
      });
      expect(newRecords).toHaveLength(2);
    });

    it("keeps saved dataset reference unchanged when copyDatasets is false", async () => {
      // Create a saved dataset
      const timestamp = Date.now();
      const sourceDataset = await prisma.dataset.create({
        data: {
          id: `dataset_nocopy_test_${timestamp}`,
          name: "No Copy Dataset",
          slug: `no-copy-dataset-${timestamp}`,
          projectId,
          columnTypes: [{ name: "input", type: "string" }],
        },
      });
      createdDatasetIds.push(sourceDataset.id);

      const state = createValidState({
        name: "Experiment No Copy Dataset",
        datasets: [
          {
            id: "saved-ref-nocopy",
            name: "No Copy Dataset",
            type: "saved" as const,
            datasetId: sourceDataset.id,
            columns: [{ id: "input", name: "input", type: "string" }],
          },
        ],
        activeDatasetId: "saved-ref-nocopy",
      });

      const created = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });
      createdExperimentIds.push(created.id);

      // Copy WITHOUT dataset copying
      const result = await caller.experiments.copy({
        experimentId: created.id,
        projectId: targetProjectId,
        sourceProjectId: projectId,
        copyDatasets: false,
      });

      const copiedState = result.experiment.workbenchState as Record<
        string,
        unknown
      >;
      const datasets = copiedState.datasets as Array<{
        datasetId?: string;
      }>;

      // Dataset reference should remain the same (pointing to source)
      expect(datasets[0]?.datasetId).toBe(sourceDataset.id);
    });

    it("generates unique slug when copying to project with existing slug", async () => {
      const state = createValidState({ name: "Duplicate Slug Test" });

      // Create source experiment
      const source = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });
      createdExperimentIds.push(source.id);

      // Copy first time
      const firstCopy = await caller.experiments.copy({
        experimentId: source.id,
        projectId: targetProjectId,
        sourceProjectId: projectId,
      });

      // Copy second time - should get a different slug
      const secondCopy = await caller.experiments.copy({
        experimentId: source.id,
        projectId: targetProjectId,
        sourceProjectId: projectId,
      });

      expect(firstCopy.experiment.slug).not.toBe(secondCopy.experiment.slug);
      // Second copy should have -2 suffix
      expect(secondCopy.experiment.slug).toBe(`${firstCopy.experiment.slug}-2`);
    });

    it("clears execution results when copying", async () => {
      const state = createValidState({
        name: "Experiment with Results",
        results: {
          runId: "run-123",
          versionId: "ver-456",
          targetOutputs: { "target-1": ["output1", "output2"] },
          targetMetadata: { "target-1": [{ cost: 0.01 }] },
          evaluatorResults: { "target-1": { "eval-1": [{ score: 0.9 }] } },
          errors: {},
        },
      });

      const created = await caller.experiments.saveEvaluationsV3({
        projectId,
        state,
      });
      createdExperimentIds.push(created.id);

      const result = await caller.experiments.copy({
        experimentId: created.id,
        projectId: targetProjectId,
        sourceProjectId: projectId,
      });

      const copiedState = result.experiment.workbenchState as Record<
        string,
        unknown
      >;

      // Results should be cleared
      expect(copiedState.results).toBeUndefined();
    });
  });
});
