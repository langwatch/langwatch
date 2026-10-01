import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { BatchEvaluationEntry, Dataset, DatasetApi } from "@langwatch/dataset-contract";
/**
 * @vitest-environment node
 * What the public evaluate doors read beyond the module, composed by the real
 * installer and answered by each owner's own `*Api`.
 * @see modules/evaluation/specs/evaluation-service.feature
 */
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { EvaluatorNotFoundError, type EvaluatorApi } from "@langwatch/evaluator-contract";
import type { Experiment, ExperimentApi } from "@langwatch/experiment-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { Workflow, WorkflowApi, WorkflowVersion } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { EVALUATION_TEST_CONFIG, installableEvaluation } from "./evaluation.fixture.ts";

const PROJECT_ID = "project-1";

const TOXICITY_MONITOR: MonitorWithEvaluator = {
  id: "monitor-1",
  projectId: PROJECT_ID,
  experimentId: null,
  evaluatorId: null,
  checkType: "azure/content_safety",
  name: "Toxicity",
  slug: "toxicity",
  executionMode: "AS_GUARDRAIL",
  enabled: false,
  preconditions: [],
  parameters: { severity: 3 },
  mappings: null,
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  evaluator: null,
};

async function boot({
  monitors = createApiFixture<MonitorApi>(),
  evaluators = createApiFixture<EvaluatorApi>(),
  modelProviders = createApiFixture<ModelProviderApi>(),
  workflows = createApiFixture<WorkflowApi>(),
  datasets = createApiFixture<DatasetApi>(),
  experiments = createApiFixture<ExperimentApi>(),
}: {
  monitors?: MonitorApi;
  evaluators?: EvaluatorApi;
  modelProviders?: ModelProviderApi;
  workflows?: WorkflowApi;
  datasets?: DatasetApi;
  experiments?: ExperimentApi;
} = {}) {
  const runtime = await createApp({ role: "api" })
    .withModules([installableEvaluation])
    .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
    .withStores(memoryStores())
    .provide({
      workflow: workflows,
      trace: createApiFixture<TraceApi>(),
      "model-provider": modelProviders,
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      evaluator: evaluators,
      monitor: monitors,
      dataset: datasets,
      experiment: experiments,
      analytics: createApiFixture<AnalyticsApi>(),
      project: createApiFixture<ProjectApi>(),
      "data-retention": createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
    })
    .boot();

  return { runtime, evaluation: runtime.service(EvaluationApi) };
}

describe("given an evaluate call names a monitor by slug", () => {
  const monitors = createApiFixture<MonitorApi>({
    findBySlug: async ({ projectId, slug }) =>
      projectId === PROJECT_ID && slug === "toxicity" ? [TOXICITY_MONITOR] : [],
  });

  describe("when the project holds that monitor", () => {
    /** @scenario "An evaluate call reads the monitor it names by slug from the monitor module" */
    it("answers the monitor the evaluate doors read", async () => {
      const { runtime, evaluation } = await boot({ monitors });

      try {
        await expect(
          evaluation.findMonitorBySlug({ projectId: PROJECT_ID, slug: "toxicity" }),
        ).resolves.toEqual({
          id: "monitor-1",
          name: "Toxicity",
          checkType: "azure/content_safety",
          parameters: { severity: 3 },
          enabled: false,
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the project holds no monitor with that slug", () => {
    /** @scenario "An evaluate call reads the monitor it names by slug from the monitor module" */
    it("answers no monitor, so the slug is read as an evaluator type", async () => {
      const { runtime, evaluation } = await boot({ monitors });

      try {
        await expect(
          evaluation.findMonitorBySlug({ projectId: PROJECT_ID, slug: "langevals/exact_match" }),
        ).resolves.toBeNull();
      } finally {
        await runtime.stop();
      }
    });
  });
});

describe("given an evaluate call names a saved evaluator", () => {
  const evaluators = createApiFixture<EvaluatorApi>({
    resolveForExecution: async ({ idOrSlug, projectId }) => {
      if (projectId !== PROJECT_ID || idOrSlug !== "my-judge") {
        throw new EvaluatorNotFoundError(idOrSlug);
      }

      return {
        evaluatorId: "evaluator-1",
        name: "My judge",
        checkType: "custom/workflow-1",
        requiredFields: ["input"],
      };
    },
  });

  describe("when the project holds it", () => {
    /** @scenario "An evaluate call resolves a saved evaluator through the evaluator module" */
    it("answers what running it needs", async () => {
      const { runtime, evaluation } = await boot({ evaluators });

      try {
        await expect(
          evaluation.resolveSavedEvaluator({ projectId: PROJECT_ID, idOrSlug: "my-judge" }),
        ).resolves.toEqual({
          checkType: "custom/workflow-1",
          settings: {},
          name: "My judge",
          evaluatorId: "evaluator-1",
          requiredFields: ["input"],
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the project does not hold it", () => {
    /** @scenario "An evaluate call resolves a saved evaluator through the evaluator module" */
    it("refuses with the evaluator module's own code", async () => {
      const { runtime, evaluation } = await boot({ evaluators });

      try {
        await expect(
          evaluation.resolveSavedEvaluator({ projectId: PROJECT_ID, idOrSlug: "absent" }),
        ).rejects.toMatchObject({ code: "evaluator_not_found" });
      } finally {
        await runtime.stop();
      }
    });
  });
});

describe("given an evaluate call reads the project's default models", () => {
  const modelProviders = createApiFixture<ModelProviderApi>({
    findResolvedDefault: async ({ featureKey }) =>
      featureKey === "evaluator.create_default"
        ? { model: "anthropic/claude-sonnet", source: "role_default", scope: "project" }
        : null,
  });

  /** @scenario "An evaluate call reads the project's default models from the cascade" */
  it("answers the cascade's model, and nothing where the cascade sets none", async () => {
    const { runtime, evaluation } = await boot({ modelProviders });

    try {
      await expect(
        evaluation.findModelForFeature({
          projectId: PROJECT_ID,
          featureKey: "evaluator.create_default",
        }),
      ).resolves.toBe("anthropic/claude-sonnet");
      await expect(
        evaluation.findModelForFeature({
          projectId: PROJECT_ID,
          featureKey: "analytics.topic_clustering_embeddings",
        }),
      ).resolves.toBeNull();
    } finally {
      await runtime.stop();
    }
  });
});

describe("given an evaluate call's evaluator reported a cost", () => {
  /** @scenario "A public evaluate call writes its cost to the ledger" */
  it("records it under the id the call chose", async () => {
    const { runtime, evaluation } = await boot();

    try {
      await expect(
        evaluation.recordEvaluationCost({
          id: "cost_1",
          projectId: PROJECT_ID,
          costType: "TRACE_CHECK",
          costName: "Toxicity",
          referenceType: "CHECK",
          referenceId: "monitor-1",
          amount: 0.01,
          currency: "USD",
          extraInfo: { trace_id: "trace-1" },
        }),
      ).resolves.toEqual({ id: "cost_1" });
    } finally {
      await runtime.stop();
    }
  });
});

const JUDGE_VERSION: WorkflowVersion = {
  id: "version-1",
  workflowId: "workflow-1",
  projectId: PROJECT_ID,
  version: "1",
  autoSaved: false,
  commitMessage: "first",
  authorId: null,
  parentId: null,
  dsl: { name: "Judge", version: "1", nodes: [], edges: [] },
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const JUDGE_WORKFLOW: Workflow = {
  id: "workflow-1",
  projectId: PROJECT_ID,
  name: "Judge",
  icon: null,
  description: null,
  latestVersionId: "version-1",
  currentVersionId: "version-1",
  publishedId: "version-1",
  publishedById: null,
  copiedFromWorkflowId: null,
  isEvaluator: true,
  isComponent: false,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("given an evaluate call names a custom workflow evaluator", () => {
  /** @scenario "An evaluate call reads the project's custom evaluators from the workflow module" */
  it("answers the project's published evaluator workflows", async () => {
    const workflows = createApiFixture<WorkflowApi>({
      findEvaluatorWorkflows: async ({ projectId }) =>
        projectId === PROJECT_ID ? [{ ...JUDGE_WORKFLOW, versions: [JUDGE_VERSION] }] : [],
    });
    const { runtime, evaluation } = await boot({ workflows });

    try {
      const [judge, ...rest] = await evaluation.listCustomEvaluators({ projectId: PROJECT_ID });

      expect(rest).toEqual([]);
      expect(judge).toMatchObject({
        id: "workflow-1",
        name: "Judge",
        versions: [{ id: "version-1", dsl: JUDGE_VERSION.dsl }],
      });
    } finally {
      await runtime.stop();
    }
  });
});

const GOLDEN_SET: Dataset = {
  id: "dataset-1",
  projectId: PROJECT_ID,
  name: "Golden set",
  slug: "golden-set",
  columnTypes: [{ name: "input", type: "string" }],
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  mapping: null,
  useS3: false,
  s3RecordCount: null,
  contentLayout: "postgres",
  status: "ready",
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: null,
  sizeBytes: null,
  chunkCount: null,
  chunkOffsets: null,
};

describe("given a dataset evaluation names a dataset by slug", () => {
  const written: BatchEvaluationEntry[] = [];
  const datasets = createApiFixture<DatasetApi>({
    findBySlug: async ({ projectId, slug }) =>
      projectId === PROJECT_ID && slug === "golden-set" ? [GOLDEN_SET] : [],
    createBatchEvaluation: async (entry) => {
      written.push(entry);
    },
  });

  /** @scenario "A dataset evaluation reads its dataset and writes its rows through the dataset module" */
  it("answers the dataset's id, and nothing for a slug the project does not hold", async () => {
    const { runtime, evaluation } = await boot({ datasets });

    try {
      await expect(
        evaluation.findDatasetBySlug({ projectId: PROJECT_ID, slug: "golden-set" }),
      ).resolves.toEqual({ id: "dataset-1" });
      await expect(
        evaluation.findDatasetBySlug({ projectId: PROJECT_ID, slug: "absent" }),
      ).resolves.toBeNull();
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "A dataset evaluation reads its dataset and writes its rows through the dataset module" */
  it("writes each scored entry as a batch-evaluation row", async () => {
    const { runtime, evaluation } = await boot({ datasets });
    const row = {
      id: "batch-1",
      experimentId: "experiment-1",
      projectId: PROJECT_ID,
      data: { input: "hello" },
      status: "processed",
      score: 1,
      passed: true,
      label: null,
      details: "",
      cost: 0,
      evaluation: "langevals/exact_match",
      datasetSlug: "golden-set",
      datasetId: "dataset-1",
    };

    try {
      await evaluation.recordDatasetEvaluationRow(row);

      expect(written).toEqual([row]);
    } finally {
      await runtime.stop();
    }
  });
});

const NIGHTLY: Experiment = {
  id: "experiment-1",
  name: "Nightly",
  type: "BATCH_EVALUATION_V2",
  slug: "nightly",
  projectId: PROJECT_ID,
  workflowId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  workbenchState: null,
  workbenchVersion: 0,
};

describe("given an SDK logs a batch of evaluation results", () => {
  function recordingExperiments() {
    const calls: [string, Record<string, unknown>][] = [];
    const experiments = createApiFixture<ExperimentApi>({
      findBySlug: async ({ projectId, slug }) =>
        projectId === PROJECT_ID && slug === "nightly" ? NIGHTLY : null,
      findOrCreateForRun: async (input) => {
        calls.push(["findOrCreateForRun", { ...input }]);
        return NIGHTLY;
      },
      startExperimentRun: async (input) => {
        calls.push(["startExperimentRun", { ...input }]);
      },
      recordTargetResult: async (input) => {
        calls.push(["recordTargetResult", { ...input }]);
      },
      recordEvaluatorResult: async (input) => {
        calls.push(["recordEvaluatorResult", { ...input }]);
      },
      completeExperimentRun: async (input) => {
        calls.push(["completeExperimentRun", { ...input }]);
      },
    });

    return { calls, experiments };
  }

  /** @scenario "An SDK batch is written into its experiment's run history through the experiment module" */
  it("finds or creates the experiment, then starts, fills and completes its run", async () => {
    const { calls, experiments } = recordingExperiments();
    const { runtime, evaluation } = await boot({ experiments });

    try {
      await evaluation.logBatchEvaluation({
        projectId: PROJECT_ID,
        params: {
          experiment_slug: "nightly",
          run_id: "run-1",
          dataset: [{ index: 0, entry: { input: "hello" }, predicted: { output: "hi" } }],
          evaluations: [{ evaluator: "exact", index: 0, status: "processed", score: 1 }],
          timestamps: { finished_at: 1_700_000_000_000 },
        },
      });

      expect(calls.map(([name]) => name)).toEqual([
        "findOrCreateForRun",
        "startExperimentRun",
        "recordTargetResult",
        "recordEvaluatorResult",
        "completeExperimentRun",
      ]);
      expect(calls[0]?.[1]).toMatchObject({
        projectId: PROJECT_ID,
        experimentSlug: "nightly",
        experimentType: "BATCH_EVALUATION_V2",
      });
      expect(calls[3]?.[1]).toMatchObject({
        tenantId: PROJECT_ID,
        runId: "run-1",
        experimentId: "experiment-1",
        evaluatorId: "exact",
        status: "processed",
        score: 1,
      });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "An SDK batch is written into its experiment's run history through the experiment module" */
  it("answers the experiment a dataset evaluation names by slug", async () => {
    const { experiments } = recordingExperiments();
    const { runtime, evaluation } = await boot({ experiments });

    try {
      await expect(
        evaluation.findExperimentBySlug({ projectId: PROJECT_ID, slug: "nightly" }),
      ).resolves.toMatchObject({ id: "experiment-1" });
      await expect(
        evaluation.findExperimentBySlug({ projectId: PROJECT_ID, slug: "absent" }),
      ).resolves.toBeNull();
    } finally {
      await runtime.stop();
    }
  });
});
