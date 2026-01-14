import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { createElasticsearchBatchEvaluationRepository } from "../elasticsearchBatchEvaluation.repository";
import type { BatchEvaluationRepository } from "../batchEvaluation.repository";
import { getTestProject, getTestUser } from "~/utils/testUtils";
import type { Project, User } from "@prisma/client";
import { prisma } from "~/server/db";
import { esClient, BATCH_EVALUATION_INDEX } from "~/server/elasticsearch";

/**
 * Integration tests for BatchEvaluationRepository with real Elasticsearch.
 * Requires:
 * - ELASTICSEARCH_NODE_URL and ELASTICSEARCH_API_KEY in environment
 * - ES migrations to have been run
 */
describe("BatchEvaluationRepository Integration", () => {
  let repository: BatchEvaluationRepository;
  let project: Project;
  let user: User;
  let experimentId: string;
  const createdRunIds: string[] = [];

  beforeAll(async () => {
    // Get test project and user
    project = await getTestProject("batch-eval-repo-test");
    user = await getTestUser();

    // Create a test experiment
    const experiment = await prisma.experiment.create({
      data: {
        id: `exp_${nanoid()}`,
        projectId: project.id,
        name: "Test Experiment",
        slug: `test-experiment-${nanoid(8)}`,
        type: "BATCH_EVALUATION_V2",
      },
    });
    experimentId = experiment.id;

    repository = createElasticsearchBatchEvaluationRepository();
  });

  afterAll(async () => {
    // Clean up created documents
    const client = await esClient({ projectId: project.id });
    for (const runId of createdRunIds) {
      try {
        await client.deleteByQuery({
          index: BATCH_EVALUATION_INDEX.alias,
          body: {
            query: {
              bool: {
                must: [
                  { term: { project_id: project.id } },
                  { term: { run_id: runId } },
                ],
              },
            },
          },
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clean up experiment
    await prisma.experiment.delete({ where: { id: experimentId, projectId: project.id } });
  });

  describe("create", () => {
    it("creates a new batch evaluation with targets", async () => {
      const runId = `run_${nanoid()}`;
      createdRunIds.push(runId);

      await repository.create({
        projectId: project.id,
        experimentId,
        runId,
        total: 10,
        targets: [
          {
            id: "target-1",
            name: "GPT-4o",
            type: "prompt",
            prompt_id: "prompt-123",
            prompt_version: 1,
            model: "openai/gpt-4o",
          },
          {
            id: "target-2",
            name: "Code Agent",
            type: "agent",
            agent_id: "agent-456",
          },
        ],
      });

      // Wait for ES to index
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify it was created
      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId,
      });

      expect(result).not.toBeNull();
      expect(result?.run_id).toBe(runId);
      expect(result?.total).toBe(10);
      expect(result?.progress).toBe(0);
      expect(result?.targets).toHaveLength(2);
      expect(result?.targets?.[0]?.name).toBe("GPT-4o");
      expect(result?.targets?.[0]?.type).toBe("prompt");
      expect(result?.targets?.[1]?.name).toBe("Code Agent");
      expect(result?.targets?.[1]?.type).toBe("agent");
    });

    it("creates a batch evaluation with targets including metadata", async () => {
      const runId = `run_${nanoid()}`;
      createdRunIds.push(runId);

      await repository.create({
        projectId: project.id,
        experimentId,
        runId,
        total: 5,
        targets: [
          {
            id: "target-1",
            name: "GPT-4o Warm",
            type: "prompt",
            prompt_id: "prompt-123",
            prompt_version: 2,
            model: "openai/gpt-4o",
            metadata: {
              temperature: 0.7,
              max_tokens: 1000,
              variant: "production",
            },
          },
          {
            id: "target-2",
            name: "GPT-4o Cold",
            type: "prompt",
            prompt_id: "prompt-123",
            prompt_version: 2,
            model: "openai/gpt-4o",
            metadata: {
              temperature: 0.0,
              max_tokens: 500,
              variant: "conservative",
            },
          },
          {
            id: "target-3",
            name: "Custom API",
            type: "custom",
            metadata: {
              endpoint: "https://api.example.com/v1",
              provider: "custom",
              use_cache: true,
            },
          },
        ],
      });

      // Wait for ES to index
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify it was created with metadata
      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId,
      });

      expect(result).not.toBeNull();
      expect(result?.targets).toHaveLength(3);

      // Check first target metadata
      const target1 = result?.targets?.find((t) => t.id === "target-1");
      expect(target1?.name).toBe("GPT-4o Warm");
      expect(target1?.type).toBe("prompt");
      expect(target1?.metadata).toEqual({
        temperature: 0.7,
        max_tokens: 1000,
        variant: "production",
      });

      // Check second target metadata
      const target2 = result?.targets?.find((t) => t.id === "target-2");
      expect(target2?.name).toBe("GPT-4o Cold");
      expect(target2?.metadata?.temperature).toBe(0.0);
      expect(target2?.metadata?.variant).toBe("conservative");

      // Check custom target
      const target3 = result?.targets?.find((t) => t.id === "target-3");
      expect(target3?.name).toBe("Custom API");
      expect(target3?.type).toBe("custom");
      expect(target3?.metadata?.endpoint).toBe("https://api.example.com/v1");
      expect(target3?.metadata?.use_cache).toBe(true);
    });

    it("creates batch evaluation without targets (backward compatible)", async () => {
      const runId = `run_${nanoid()}`;
      createdRunIds.push(runId);

      await repository.create({
        projectId: project.id,
        experimentId,
        runId,
        total: 5,
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId,
      });

      expect(result).not.toBeNull();
      // When no targets provided, it should be null or undefined
      expect(result?.targets ?? null).toBeNull();
    });
  });

  describe("upsertResults", () => {
    it("adds dataset entries incrementally", async () => {
      const runId = `run_${nanoid()}`;
      createdRunIds.push(runId);

      // Create initial record
      await repository.create({
        projectId: project.id,
        experimentId,
        runId,
        total: 3,
        targets: [{ id: "target-1", name: "Test Target", type: "prompt" }],
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Add first result
      await repository.upsertResults({
        projectId: project.id,
        experimentId,
        runId,
        dataset: [
          {
            index: 0,
            target_id: "target-1",
            entry: { question: "Hello" },
            predicted: { output: "Hi there!" },
            cost: 0.001,
            duration: 500,
          },
        ],
        progress: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Add second result
      await repository.upsertResults({
        projectId: project.id,
        experimentId,
        runId,
        dataset: [
          {
            index: 1,
            target_id: "target-1",
            entry: { question: "World" },
            predicted: { output: "Hello World!" },
            cost: 0.002,
            duration: 600,
          },
        ],
        progress: 2,
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify both results are there
      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId,
      });

      expect(result?.dataset).toHaveLength(2);
      expect(result?.progress).toBe(2);
      expect(result?.dataset?.find((d) => d.index === 0)?.predicted?.output).toBe("Hi there!");
      expect(result?.dataset?.find((d) => d.index === 1)?.predicted?.output).toBe("Hello World!");
    });

    it("adds evaluation results with target_id", async () => {
      const runId = `run_${nanoid()}`;
      createdRunIds.push(runId);

      await repository.create({
        projectId: project.id,
        experimentId,
        runId,
        total: 2,
        targets: [
          { id: "target-1", name: "Target 1", type: "prompt" },
          { id: "target-2", name: "Target 2", type: "prompt" },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Add evaluations for both targets
      await repository.upsertResults({
        projectId: project.id,
        experimentId,
        runId,
        evaluations: [
          {
            evaluator: "exact_match",
            target_id: "target-1",
            index: 0,
            status: "processed",
            passed: true,
            score: 1.0,
          },
          {
            evaluator: "exact_match",
            target_id: "target-2",
            index: 0,
            status: "processed",
            passed: false,
            score: 0.0,
          },
        ],
        progress: 2,
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId,
      });

      expect(result?.evaluations).toHaveLength(2);

      const target1Eval = result?.evaluations?.find((e) => e.target_id === "target-1");
      const target2Eval = result?.evaluations?.find((e) => e.target_id === "target-2");

      expect(target1Eval?.passed).toBe(true);
      expect(target2Eval?.passed).toBe(false);
    });

    it("does not duplicate entries on re-upsert", async () => {
      const runId = `run_${nanoid()}`;
      createdRunIds.push(runId);

      await repository.create({
        projectId: project.id,
        experimentId,
        runId,
        total: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Upsert same entry twice
      const entry = {
        index: 0,
        target_id: "target-1",
        entry: { question: "Test" },
        predicted: { output: "Response" },
      };

      await repository.upsertResults({
        projectId: project.id,
        experimentId,
        runId,
        dataset: [entry],
        progress: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await repository.upsertResults({
        projectId: project.id,
        experimentId,
        runId,
        dataset: [entry],
        progress: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId,
      });

      // Should still have only one entry
      expect(result?.dataset).toHaveLength(1);
    });
  });

  describe("markComplete", () => {
    it("sets finished_at timestamp", async () => {
      const runId = `run_${nanoid()}`;
      createdRunIds.push(runId);

      await repository.create({
        projectId: project.id,
        experimentId,
        runId,
        total: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const finishedAt = Date.now();
      await repository.markComplete({
        projectId: project.id,
        experimentId,
        runId,
        finishedAt,
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId,
      });

      expect(result?.timestamps.finished_at).toBe(finishedAt);
      expect(result?.timestamps.stopped_at).toBeUndefined();
    });

    it("sets stopped_at timestamp on abort", async () => {
      const runId = `run_${nanoid()}`;
      createdRunIds.push(runId);

      await repository.create({
        projectId: project.id,
        experimentId,
        runId,
        total: 10,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const stoppedAt = Date.now();
      await repository.markComplete({
        projectId: project.id,
        experimentId,
        runId,
        stoppedAt,
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId,
      });

      expect(result?.timestamps.stopped_at).toBe(stoppedAt);
      expect(result?.timestamps.finished_at).toBeUndefined();
    });
  });

  describe("getByRunId", () => {
    it("returns null for non-existent run", async () => {
      const result = await repository.getByRunId({
        projectId: project.id,
        experimentId,
        runId: "non-existent-run",
      });

      expect(result).toBeNull();
    });
  });

  describe("listByExperiment", () => {
    it("lists batch evaluations for experiment", async () => {
      // Create a few runs
      const runIds = [`run_${nanoid()}`, `run_${nanoid()}`];
      createdRunIds.push(...runIds);

      for (const runId of runIds) {
        await repository.create({
          projectId: project.id,
          experimentId,
          runId,
          total: 5,
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const results = await repository.listByExperiment({
        projectId: project.id,
        experimentId,
      });

      // Should have at least the runs we created
      expect(results.length).toBeGreaterThanOrEqual(2);

      // All results should be for this experiment
      for (const result of results) {
        expect(result.experiment_id).toBe(experimentId);
        expect(result.project_id).toBe(project.id);
      }
    });

    it("respects limit parameter", async () => {
      const results = await repository.listByExperiment({
        projectId: project.id,
        experimentId,
        limit: 1,
      });

      expect(results.length).toBeLessThanOrEqual(1);
    });
  });
});
