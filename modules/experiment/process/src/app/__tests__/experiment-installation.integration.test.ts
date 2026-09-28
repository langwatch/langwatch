/**
 * Experiment installed the way the worker installs it, over the memory tier and
 * real peer resolution: an empty ClickHouse, a Redis nothing reads at boot, no queue.
 * @vitest-environment node
 */
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { createApp } from "@langwatch/kernel";
import type { ModelCost, ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { memoryStores } from "@langwatch/process-stores";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createTestLogger } from "@langwatch/test-harness";
import {
  parseStudioWorkflow,
  type WorkflowApi,
  type WorkflowVersion,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { experimentServer } from "../../experiment.server.ts";

/** A ClickHouse that holds no rows: every read answers empty, every write is kept. */
class EmptyDriver implements QueryDriver {
  readonly inserts: InsertRequest[] = [];

  execute<Row>(): Promise<QueryResult<Row>> {
    return Promise.resolve({ rows: [] });
  }

  insert(request: InsertRequest): Promise<void> {
    this.inserts.push(request);
    return Promise.resolve();
  }

  command(): Promise<void> {
    return Promise.resolve();
  }
}

const customCost: ModelCost = {
  id: "cost_1",
  organizationId: "organization_1",
  projectId: "project_1",
  scopeType: "PROJECT",
  scopeId: "project_1",
  model: "my-fine-tune",
  regex: "^my-fine-tune$",
  inputCostPerToken: 0.001,
  outputCostPerToken: 0.002,
  cacheReadCostPerToken: null,
  cacheCreationCostPerToken: null,
  cacheCreation1hCostPerToken: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const RETAINED = { traces: 91, scenarios: 63, experiments: 126 };

async function bootWorker(workflow = createApiFixture<WorkflowApi>({})) {
  let retentionReads = 0;
  const driver = new EmptyDriver();
  const eventing = new EventSourcing({
    enabled: false,
    participation: "consume",
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const runtime = await createApp({ role: "worker" })
    .withModules([experimentServer])
    .withStores(memoryStores())
    .withEventing(eventing)
    .withRelational(createApiFixture<ProcessMembers["prisma"]>({}, "prisma (unused at boot)"))
    .withAnalytical(new ClickHouseQueryClient({ driver }))
    .withKeyvalue(
      createApiFixture<NonNullable<ProcessMembers["redis"]>>({}, "redis (unused at boot)"),
    )
    .withConfig({
      experiment: { blockLocalHttpCalls: false, allowedProxyHosts: [], runConcurrency: 10 },
    })
    .withMember("publicBaseUrl", undefined)
    .withMember("processName", "langwatch-test")
    .withMember("isSaas", false)
    .withObservability((observability) => observability.withLogging(createTestLogger().logger))
    .provide({
      workflow,
      dataset: createApiFixture<DatasetApi>({}),
      monitor: createApiFixture<MonitorApi>({}),
      agent: createApiFixture<AgentApi>({}),
      evaluator: createApiFixture<EvaluatorApi>({}),
      prompt: createApiFixture<PromptApi>({}),
      authz: createApiFixture<AuthzApi>({}),
      project: createApiFixture<ProjectApi>({}),
      entitlement: createApiFixture<EntitlementApi>({}),
      evaluation: createApiFixture<EvaluationApi>({}),
      "api-key": createApiFixture<ApiKeyApi>({}),
      suite: createApiFixture<SuiteApi>({}),
      "stored-object": createApiFixture<StoredObjectApi>({}),
      "model-provider": createApiFixture<ModelProviderApi>({
        listCosts: () => Promise.resolve([customCost]),
      }),
      "data-retention": createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => {
          retentionReads += 1;
          return 49;
        },
        getRetentionDays: async ({ category }) => RETAINED[category],
        getResolvedForProject: async () => RETAINED,
      }),
    })
    .boot();
  return { runtime, eventing, driver, retentionReads: () => retentionReads };
}

describe("experiment installed in the worker", () => {
  /** @scenario "The worker registers the run pipeline from experiment's own declaration" */
  /** @scenario "The worker mounts the pipeline rather than being handed one" */
  it("registers experiment_run_processing from its own declaration", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const pipelines = eventing.definitions.map((definition) => definition.metadata.name);
      expect(pipelines).toContain("experiment_run_processing");
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Building the run pipeline reads no retention from its peer" */
  it("reads no retention from its peer while the pipeline is built", async () => {
    const { runtime, retentionReads } = await bootWorker();

    try {
      expect(retentionReads()).toBe(0);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The run pipeline declares each tenant's retention from data retention" */
  it("declares each tenant's retention on experiment_run_processing", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const pipeline = eventing.definitions.find(
        (definition) => definition.metadata.name === "experiment_run_processing",
      );
      await expect(
        pipeline?.open((definition) => definition.retentionPolicyResolver?.resolve("project_1")),
      ).resolves.toEqual(RETAINED);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "A DSPy step is stamped with its tenant's traces retention" */
  it("stamps a DSPy step with the tenant's traces retention, not a fixed one", async () => {
    const { runtime, driver } = await bootWorker();

    try {
      await runtime.service(ExperimentApi).upsertDspyStep({
        tenantId: "project_1",
        experimentId: "experiment_1",
        runId: "run_1",
        stepIndex: "0",
        score: 0.5,
        label: "score",
        optimizerName: "MIPROv2",
        optimizerParameters: {},
        predictors: [],
        examples: [],
        llmCalls: [],
        createdAt: 1_000,
        insertedAt: 1_100,
        updatedAt: 1_200,
      });

      expect(driver.inserts.flatMap((insert) => insert.rows)).toEqual([
        expect.objectContaining({ _retention_days: RETAINED.traces }),
      ]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "A run no experiment recorded answers not recorded" */
  it("answers a run no experiment recorded as not recorded", async () => {
    const { runtime } = await bootWorker();

    try {
      await expect(
        runtime
          .service(ExperimentApi)
          .lookupExperimentId({ tenantId: "project_1", runId: "run_1" }),
      ).resolves.toEqual({ kind: "not_recorded" });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The optimizer log prices against the project's cost rules and the static catalogue" */
  it("lists the project's custom cost rules ahead of the static catalogue", async () => {
    const { runtime } = await bootWorker();

    try {
      const rates = await runtime.service(ExperimentApi).listModelCosts({ projectId: "project_1" });

      expect(rates[0]).toEqual({
        model: "my-fine-tune",
        regex: "^my-fine-tune$",
        inputCostPerToken: 0.001,
        outputCostPerToken: 0.002,
        cacheReadCostPerToken: undefined,
        cacheCreationCostPerToken: undefined,
        cacheCreation1hCostPerToken: undefined,
      });
      expect(rates.length).toBeGreaterThan(1);
    } finally {
      await runtime.stop();
    }
  });

  describe("when the legacy wizard writes its workflow", () => {
    const caller = { id: "user_1" };
    const dsl = parseStudioWorkflow({
      spec_version: "1.4",
      name: "Draft 1 - Workflow",
      icon: "x",
      description: "x",
      version: "1",
      nodes: [],
      edges: [],
      state: {},
    });
    const version: WorkflowVersion = {
      id: "version_1",
      workflowId: "workflow_1",
      projectId: "project_1",
      version: "1",
      autoSaved: false,
      commitMessage: "Autosaved",
      authorId: caller.id,
      parentId: null,
      dsl,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const created: WorkflowWithVersion = {
      id: "workflow_1",
      projectId: "project_1",
      name: dsl.name,
      icon: dsl.icon,
      description: dsl.description,
      latestVersionId: version.id,
      currentVersionId: version.id,
      publishedId: null,
      publishedById: null,
      copiedFromWorkflowId: null,
      isEvaluator: false,
      isComponent: false,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      currentVersion: version,
    };

    /** @scenario "A new wizard experiment's first save creates its workflow with one version" */
    it("creates the workflow with its prepared graph as version one, as the caller", async () => {
      const prepared = { ...dsl, description: "prepared" };
      const create = vi.fn(async () => ({ workflow: created, version }));
      const saveStudioVersion = vi.fn(async () => version);
      const { runtime } = await bootWorker(
        createApiFixture<WorkflowApi>({
          prepareStudioDsl: async () => prepared,
          create,
          saveStudioVersion,
        }),
      );

      try {
        await expect(
          runtime
            .service(ExperimentApi)
            .createWorkflow(
              { projectId: "project_1", dsl, commitMessage: "Autosaved", autoSaved: true },
              caller,
            ),
        ).resolves.toEqual({ id: "workflow_1" });
        expect(create).toHaveBeenCalledWith(
          { projectId: "project_1", dsl: prepared, commitMessage: "Autosaved", autoSaved: true },
          caller,
        );
        expect(saveStudioVersion).not.toHaveBeenCalled();
      } finally {
        await runtime.stop();
      }
    });

    it("saves a later version through the Studio's own save, as the caller", async () => {
      const saveStudioVersion = vi.fn(async () => version);
      const { runtime } = await bootWorker(createApiFixture<WorkflowApi>({ saveStudioVersion }));
      const input = {
        projectId: "project_1",
        workflowId: "workflow_1",
        dsl,
        autoSaved: true,
        commitMessage: "Autosaved",
        setAsLatestVersion: true,
      };

      try {
        await runtime.service(ExperimentApi).saveWorkflowVersion(input, caller);
        expect(saveStudioVersion).toHaveBeenCalledWith(input, caller);
      } finally {
        await runtime.stop();
      }
    });
  });
});
