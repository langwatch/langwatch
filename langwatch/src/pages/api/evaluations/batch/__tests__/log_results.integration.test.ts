import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "../log_results";
import { getTestProject } from "~/utils/testUtils";
import type { Project } from "@prisma/client";
import { prisma } from "~/server/db";
import { esClient, BATCH_EVALUATION_INDEX, batchEvaluationId } from "~/server/elasticsearch";
import type { ESBatchEvaluation } from "~/server/experiments/types";
import { slugify } from "~/utils/slugify";

/**
 * Integration tests for log_results API with targets and metadata.
 * Requires:
 * - ELASTICSEARCH_NODE_URL and ELASTICSEARCH_API_KEY in environment
 * - ES migrations to have been run
 */
describe("log_results API Integration", () => {
  let project: Project;
  const createdRunIds: string[] = [];
  const createdExperimentIds: string[] = [];

  beforeAll(async () => {
    project = await getTestProject("log-results-api-test");
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

    // Clean up experiments
    for (const expId of createdExperimentIds) {
      try {
        await prisma.experiment.delete({ where: { id: expId, projectId: project.id } });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  const callApi = async (body: Record<string, unknown>) => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-auth-token": project.apiKey,
      },
      body,
    });

    await handler(req, res);
    return { statusCode: res._getStatusCode(), data: res._getJSONData() };
  };

  const getExperiment = async (experimentSlug: string) => {
    const slug = slugify(experimentSlug);
    // Wait a bit for transaction to complete
    await new Promise((resolve) => setTimeout(resolve, 200));
    const experiment = await prisma.experiment.findFirst({
      where: { slug, projectId: project.id },
    });
    if (experiment) {
      createdExperimentIds.push(experiment.id);
    }
    return experiment;
  };

  const getFromEs = async (experimentId: string, runId: string): Promise<ESBatchEvaluation | null> => {
    const client = await esClient({ projectId: project.id });
    const id = batchEvaluationId({ projectId: project.id, experimentId, runId });
    try {
      const result = await client.get<ESBatchEvaluation>({
        index: BATCH_EVALUATION_INDEX.alias,
        id,
      });
      return result._source ?? null;
    } catch (error: unknown) {
      const err = error as { statusCode?: number; meta?: { statusCode?: number } };
      if (err?.statusCode === 404 || err?.meta?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  };

  describe("targets with metadata", () => {
    it("stores targets with metadata from API payload", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-targets-${nanoid(8)}`;
      createdRunIds.push(runId);

      const { statusCode, data } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          {
            id: "gpt4-baseline",
            name: "GPT-4 Baseline",
            type: "custom",
            metadata: {
              model: "openai/gpt-4",
              temperature: 0.7,
              max_tokens: 1000,
            },
          },
          {
            id: "claude-experiment",
            name: "Claude Experiment",
            type: "custom",
            metadata: {
              model: "anthropic/claude-3-opus",
              temperature: 0.5,
            },
          },
        ],
        dataset: [
          {
            index: 0,
            target_id: "gpt4-baseline",
            entry: { question: "Hello" },
            predicted: { answer: "Hi there!" },
          },
        ],
        evaluations: [
          {
            evaluator: "accuracy",
            target_id: "gpt4-baseline",
            index: 0,
            status: "processed",
            score: 0.95,
            passed: true,
          },
        ],
      });

      expect(statusCode).toBe(200);
      expect(data).toEqual({ message: "ok" });

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      // Wait for ES to index
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify in Elasticsearch
      const stored = await getFromEs(experiment!.id, runId);
      expect(stored).not.toBeNull();
      expect(stored?.targets).toHaveLength(2);

      const target1 = stored?.targets?.find((t) => t.id === "gpt4-baseline");
      expect(target1?.name).toBe("GPT-4 Baseline");
      expect(target1?.type).toBe("custom");
      expect(target1?.metadata).toEqual({
        model: "openai/gpt-4",
        temperature: 0.7,
        max_tokens: 1000,
      });

      const target2 = stored?.targets?.find((t) => t.id === "claude-experiment");
      expect(target2?.name).toBe("Claude Experiment");
      expect(target2?.metadata?.model).toBe("anthropic/claude-3-opus");
    });

    it("extracts type from metadata if provided", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-type-extraction-${nanoid(8)}`;
      createdRunIds.push(runId);

      const { statusCode } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          {
            id: "my-prompt",
            name: "My Prompt Target",
            // Not specifying type at top level, but in metadata
            metadata: {
              type: "prompt",
              model: "openai/gpt-4",
              version: 3,
            },
          },
        ],
        dataset: [],
        evaluations: [],
      });

      expect(statusCode).toBe(200);

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const stored = await getFromEs(experiment!.id, runId);
      expect(stored?.targets).toHaveLength(1);

      const target = stored?.targets?.[0];
      // Type should be extracted from metadata
      expect(target?.type).toBe("prompt");
      // Type should be removed from metadata
      expect(target?.metadata).toEqual({
        model: "openai/gpt-4",
        version: 3,
      });
      expect(target?.metadata?.type).toBeUndefined();
    });

    it("rejects invalid type in metadata", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-invalid-type-${nanoid(8)}`;

      const { statusCode } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          {
            id: "bad-target",
            name: "Bad Target",
            metadata: {
              type: "invalid_type",
            },
          },
        ],
        dataset: [],
        evaluations: [],
      });

      // Invalid type should result in 500 error
      expect(statusCode).toBe(500);
    });

    it("defaults to custom type when no type specified", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-default-type-${nanoid(8)}`;
      createdRunIds.push(runId);

      const { statusCode } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          {
            id: "api-target",
            name: "API Target",
            // No type specified anywhere
            metadata: {
              endpoint: "https://api.example.com",
            },
          },
        ],
        dataset: [],
        evaluations: [],
      });

      expect(statusCode).toBe(200);

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const stored = await getFromEs(experiment!.id, runId);
      expect(stored?.targets?.[0]?.type).toBe("custom");
    });

    it("merges targets on subsequent calls", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-merge-targets-${nanoid(8)}`;
      createdRunIds.push(runId);

      // First call with one target
      await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          {
            id: "target-1",
            name: "Target 1",
            type: "custom",
            metadata: { model: "gpt-4" },
          },
        ],
        dataset: [{ index: 0, entry: { q: "test" } }],
        evaluations: [],
      });

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Second call with another target
      await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          {
            id: "target-2",
            name: "Target 2",
            type: "custom",
            metadata: { model: "claude-3" },
          },
        ],
        dataset: [{ index: 1, entry: { q: "test2" } }],
        evaluations: [],
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const stored = await getFromEs(experiment!.id, runId);
      // Should have both targets
      expect(stored?.targets).toHaveLength(2);
      expect(stored?.targets?.find((t) => t.id === "target-1")).toBeDefined();
      expect(stored?.targets?.find((t) => t.id === "target-2")).toBeDefined();
    });

    it("does not duplicate targets with same id", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-no-dup-targets-${nanoid(8)}`;
      createdRunIds.push(runId);

      // First call
      await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          {
            id: "same-target",
            name: "Same Target",
            type: "custom",
            metadata: { v: 1 },
          },
        ],
        dataset: [],
        evaluations: [],
      });

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Second call with same target id
      await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          {
            id: "same-target",
            name: "Same Target Updated",
            type: "custom",
            metadata: { v: 2 },
          },
        ],
        dataset: [],
        evaluations: [],
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const stored = await getFromEs(experiment!.id, runId);
      // Should still have only one target (first one wins)
      expect(stored?.targets).toHaveLength(1);
      expect(stored?.targets?.[0]?.id).toBe("same-target");
    });

    it("works without targets (backward compatible)", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-no-targets-${nanoid(8)}`;
      createdRunIds.push(runId);

      const { statusCode } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        dataset: [
          {
            index: 0,
            entry: { input: "Hello" },
            predicted: { output: "Hi" },
          },
        ],
        evaluations: [
          {
            evaluator: "accuracy",
            index: 0,
            status: "processed",
            score: 1.0,
          },
        ],
      });

      expect(statusCode).toBe(200);

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const stored = await getFromEs(experiment!.id, runId);
      expect(stored).not.toBeNull();
      // Targets should be null or empty
      expect(stored?.targets ?? null).toBeNull();
      // But dataset and evaluations should be there
      expect(stored?.dataset).toHaveLength(1);
      expect(stored?.evaluations).toHaveLength(1);
    });

    it("stores evaluations for multiple targets with same evaluator and index", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-multi-target-evals-${nanoid(8)}`;
      createdRunIds.push(runId);

      // First batch - all targets registered, gpt-4 evaluations sent
      const { statusCode: status1 } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          { id: "gpt-4", name: "GPT-4", type: "custom", metadata: { model: "openai/gpt-4" } },
          { id: "gpt-3.5", name: "GPT-3.5", type: "custom", metadata: { model: "openai/gpt-3.5-turbo" } },
          { id: "claude-3", name: "Claude-3", type: "custom", metadata: { model: "anthropic/claude-3" } },
        ],
        dataset: [
          { index: 0, entry: { question: "Question 1" } },
          { index: 1, entry: { question: "Question 2" } },
        ],
        evaluations: [
          { evaluator: "latency", name: "latency", target_id: "gpt-4", index: 0, status: "processed", score: 100 },
          { evaluator: "quality", name: "quality", target_id: "gpt-4", index: 0, status: "processed", score: 0.9 },
          { evaluator: "latency", name: "latency", target_id: "gpt-4", index: 1, status: "processed", score: 150 },
          { evaluator: "quality", name: "quality", target_id: "gpt-4", index: 1, status: "processed", score: 0.85 },
        ],
        progress: 2,
        total: 6,
      });

      expect(status1).toBe(200);

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Second batch - gpt-3.5 evaluations
      const { statusCode: status2 } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [],
        dataset: [],
        evaluations: [
          { evaluator: "latency", name: "latency", target_id: "gpt-3.5", index: 0, status: "processed", score: 80 },
          { evaluator: "quality", name: "quality", target_id: "gpt-3.5", index: 0, status: "processed", score: 0.8 },
          { evaluator: "latency", name: "latency", target_id: "gpt-3.5", index: 1, status: "processed", score: 90 },
          { evaluator: "quality", name: "quality", target_id: "gpt-3.5", index: 1, status: "processed", score: 0.75 },
        ],
        progress: 4,
        total: 6,
      });

      expect(status2).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Third batch - claude-3 evaluations
      const { statusCode: status3 } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [],
        dataset: [],
        evaluations: [
          { evaluator: "latency", name: "latency", target_id: "claude-3", index: 0, status: "processed", score: 120 },
          { evaluator: "quality", name: "quality", target_id: "claude-3", index: 0, status: "processed", score: 0.95 },
          { evaluator: "latency", name: "latency", target_id: "claude-3", index: 1, status: "processed", score: 130 },
          { evaluator: "quality", name: "quality", target_id: "claude-3", index: 1, status: "processed", score: 0.92 },
        ],
        progress: 6,
        total: 6,
        timestamps: { finished_at: Date.now() },
      });

      expect(status3).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify all evaluations were stored
      const stored = await getFromEs(experiment!.id, runId);
      expect(stored).not.toBeNull();

      // Should have 3 targets
      expect(stored?.targets).toHaveLength(3);

      // Should have 12 evaluations total: 3 targets * 2 rows * 2 evaluators
      expect(stored?.evaluations).toHaveLength(12);

      // Verify evaluations for each target
      const gpt4Evals = stored?.evaluations?.filter((e) => e.target_id === "gpt-4");
      const gpt35Evals = stored?.evaluations?.filter((e) => e.target_id === "gpt-3.5");
      const claude3Evals = stored?.evaluations?.filter((e) => e.target_id === "claude-3");

      expect(gpt4Evals).toHaveLength(4);
      expect(gpt35Evals).toHaveLength(4);
      expect(claude3Evals).toHaveLength(4);

      // Verify each target has correct latency scores
      const gpt4Latency0 = gpt4Evals?.find((e) => e.evaluator === "latency" && e.index === 0);
      const gpt35Latency0 = gpt35Evals?.find((e) => e.evaluator === "latency" && e.index === 0);
      const claude3Latency0 = claude3Evals?.find((e) => e.evaluator === "latency" && e.index === 0);

      expect(gpt4Latency0?.score).toBe(100);
      expect(gpt35Latency0?.score).toBe(80);
      expect(claude3Latency0?.score).toBe(120);
    });

    it("stores dataset entries for multiple targets at same index", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-multi-target-dataset-${nanoid(8)}`;
      createdRunIds.push(runId);

      // First batch - gpt-4 dataset entry at index 0
      const { statusCode: status1 } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [
          { id: "gpt-4", name: "GPT-4", type: "custom", metadata: { model: "openai/gpt-4" } },
          { id: "gpt-3.5", name: "GPT-3.5", type: "custom", metadata: { model: "openai/gpt-3.5-turbo" } },
          { id: "claude", name: "Claude", type: "custom", metadata: { model: "anthropic/claude-3" } },
        ],
        dataset: [
          { index: 0, target_id: "gpt-4", entry: { question: "Q1" }, predicted: { output: "GPT-4 answer" }, duration: 500 },
        ],
        evaluations: [
          { evaluator: "quality", target_id: "gpt-4", index: 0, status: "processed", score: 0.9 },
        ],
        progress: 1,
        total: 3,
      });

      expect(status1).toBe(200);

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Second batch - gpt-3.5 dataset entry at same index 0
      const { statusCode: status2 } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [],
        dataset: [
          { index: 0, target_id: "gpt-3.5", entry: { question: "Q1" }, predicted: { output: "GPT-3.5 answer" }, duration: 200 },
        ],
        evaluations: [
          { evaluator: "quality", target_id: "gpt-3.5", index: 0, status: "processed", score: 0.8 },
        ],
        progress: 2,
        total: 3,
      });

      expect(status2).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Third batch - claude dataset entry at same index 0
      const { statusCode: status3 } = await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        targets: [],
        dataset: [
          { index: 0, target_id: "claude", entry: { question: "Q1" }, predicted: { output: "Claude answer" }, duration: 300 },
        ],
        evaluations: [
          { evaluator: "quality", target_id: "claude", index: 0, status: "processed", score: 0.85 },
        ],
        progress: 3,
        total: 3,
        timestamps: { finished_at: Date.now() },
      });

      expect(status3).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify all dataset entries were stored (3 entries for the same index 0, different targets)
      const stored = await getFromEs(experiment!.id, runId);
      expect(stored).not.toBeNull();

      // Should have 3 dataset entries (one per target)
      expect(stored?.dataset).toHaveLength(3);

      // Verify each target has its own dataset entry
      const gpt4Entry = stored?.dataset?.find((d) => d.target_id === "gpt-4");
      const gpt35Entry = stored?.dataset?.find((d) => d.target_id === "gpt-3.5");
      const claudeEntry = stored?.dataset?.find((d) => d.target_id === "claude");

      expect(gpt4Entry).toBeDefined();
      expect(gpt35Entry).toBeDefined();
      expect(claudeEntry).toBeDefined();

      // Verify predicted outputs are correct
      expect(gpt4Entry?.predicted?.output).toBe("GPT-4 answer");
      expect(gpt35Entry?.predicted?.output).toBe("GPT-3.5 answer");
      expect(claudeEntry?.predicted?.output).toBe("Claude answer");

      // Verify durations are correct (different per target)
      expect(gpt4Entry?.duration).toBe(500);
      expect(gpt35Entry?.duration).toBe(200);
      expect(claudeEntry?.duration).toBe(300);
    });

    it("handles evaluations without target_id (single-target case)", async () => {
      const runId = `run_${nanoid()}`;
      const experimentSlug = `test-single-target-${nanoid(8)}`;
      createdRunIds.push(runId);

      // First batch - evaluation without target_id
      await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        dataset: [
          { index: 0, entry: { question: "Q1" } },
        ],
        evaluations: [
          { evaluator: "accuracy", index: 0, status: "processed", score: 0.9 },
        ],
      });

      const experiment = await getExperiment(experimentSlug);
      expect(experiment).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Second batch - duplicate evaluation without target_id should be ignored
      await callApi({
        run_id: runId,
        experiment_slug: experimentSlug,
        dataset: [],
        evaluations: [
          { evaluator: "accuracy", index: 0, status: "processed", score: 0.95 },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const stored = await getFromEs(experiment!.id, runId);
      expect(stored).not.toBeNull();

      // Should have only 1 evaluation (first one wins, no duplicate)
      expect(stored?.evaluations).toHaveLength(1);
      expect(stored?.evaluations?.[0]?.score).toBe(0.9); // First one preserved
    });
  });
});
