import { readFile } from "node:fs/promises";

import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
/**
 * The experiment application: the rules that moved off its two doors onto it.
 * @vitest-environment node
 */
import { credentialPrincipalOfToken } from "@langwatch/api/rest";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { Experiment, ExperimentPublishedMonitor } from "@langwatch/experiment-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import type { PromptApi } from "@langwatch/prompt-contract";
import { WorkflowNotFoundError, type WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import type { ExperimentWorkflowDsl } from "../../services/experiment-execution-data.service.ts";
import { ExperimentFindOrCreateService } from "../../services/experiment-find-or-create.service.ts";
import type { WorkflowEvaluationService } from "../../services/experiment-workflow-evaluation.service.ts";
import type { ExperimentService } from "../../services/experiment.service.ts";
import type { ExperimentV3RestApi } from "../../transport/experiment-v3.rest.ts";
import type { ExperimentV3RunLoop } from "../experiment-workbench.members.ts";
import { ExperimentApp } from "../experiment.app.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const experiment: Experiment = {
  id: "experiment-1",
  projectId: "project-1",
  slug: "support-email-classifier",
  name: "Support email classifier",
  type: "EVALUATIONS_V3",
  workflowId: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  workbenchState: null,
  workbenchVersion: 0,
};

const monitor: ExperimentPublishedMonitor = {
  id: "monitor-1",
  projectId: "project-1",
  experimentId: "experiment-1",
  evaluatorId: null,
  checkType: "langevals/llm_boolean",
  name: "Support email classifier",
  slug: "support-email-classifier",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [],
  parameters: {},
  mappings: null,
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const workflowBacked = { ...experiment, id: "experiment-2", workflowId: "workflow-1" };

/** A scoped API key, as the process resolves one. */
const apiKeyToken = ({
  userId,
  isLangySessionKey,
}: {
  userId: string | null;
  isLangySessionKey: boolean;
}): ResolvedApiKeyCredential => ({
  type: "apiKey",
  apiKeyId: "key-1",
  userId,
  organizationId: "organization-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  isLangySessionKey,
  project: {
    id: "project-1",
    name: "Project One",
    slug: "project-one",
    teamId: "team-1",
    organizationId: "organization-1",
    isPersonal: false,
    ownerUserId: null,
  },
});

function harness({
  experiments = {},
  workflows = {},
}: {
  experiments?: Partial<ExperimentService>;
  workflows?: Partial<WorkflowApi>;
} = {}) {
  const experimentService = createApiFixture<ExperimentService>({
    findById: vi.fn(async () => experiment),
    archive: vi.fn(async () => ({ success: true as const })),
    getRunAggregates: vi.fn(async () => ({})),
    saveWorkbenchState: vi.fn(async () => ({
      experimentId: "experiment-1",
      slug: "s",
      version: 1,
    })),
    createEvaluationsV3: vi.fn(async () => ({
      experimentId: "experiment-1",
      slug: "s",
      version: 1,
    })),
    commitWorkbenchVersion: vi.fn(async () => ({
      experimentId: "experiment-1",
      slug: "s",
      version: 2,
    })),
    restoreWorkbenchVersion: vi.fn(async () => ({
      experimentId: "experiment-1",
      slug: "s",
      version: 3,
    })),
    ...experiments,
  });

  const workflowRow = {
    id: "workflow-1",
    projectId: "project-1",
    name: "Workflow",
    icon: null,
    description: null,
    latestVersionId: null,
    currentVersionId: null,
    publishedId: null,
    publishedById: null,
    copiedFromWorkflowId: null,
    isEvaluator: false,
    isComponent: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const archiveWorkflow = vi.fn(async () => workflowRow);
  const workflowService = createApiFixture<WorkflowApi>({
    getById: vi.fn(async () => workflowRow),
    archive: archiveWorkflow,
    ...workflows,
  });
  const workflowExecutionService = createApiFixture<WorkflowApi>();

  const monitors = {
    deleteForExperiment: vi.fn(async () => undefined),
    upsertForExperiment: vi.fn(async () => monitor),
  };
  const workflowAuthoring = {
    create: vi.fn(async () => ({ id: "workflow-1" })),
    saveVersion: vi.fn(async () => undefined),
    copyWithDatasets: vi.fn(async () => ({
      workflowId: "workflow-2",
      dsl: {
        spec_version: "1.5",
        version: "1",
        name: "Copied workflow",
        icon: "",
        description: "",
        nodes: [],
        edges: [],
        state: {},
      },
    })),
  };
  const runLookup = ExperimentFindOrCreateService.create(experimentService);
  const permissions = { mayManageEvaluations: vi.fn(async () => true) };
  const people = { namesOf: vi.fn(async () => []) };
  const modelCosts = { listFor: vi.fn(async () => []) };
  const broadcast = {
    getTenantEmitter: vi.fn(),
    cleanupTenantEmitter: vi.fn(),
  };
  const workbenchObserver = { recordExperimentRan: vi.fn(), reportError: vi.fn() };
  const runLoop: ExperimentV3RunLoop = {
    ports: null,
    progress: null,
    services: {
      datasets: createApiFixture<DatasetApi>(),
      prompts: createApiFixture<PromptApi>(),
      agents: createApiFixture<AgentApi>(),
      workflows: createApiFixture<ExperimentWorkflowDsl>(),
      entitlements: {
        requestBound: async ({ key }: { key: RequestBoundKey }) => resolveRequestBound(key, "FREE"),
      },
      projects: {
        getOrganizationId: async (projectId: string) => `organization-of-${projectId}`,
      },
    },
    workflows: workflowExecutionService,
    defaultConcurrency: 10,
    startRun: vi.fn(async () => ({ runId: "run-1", runUrl: "https://app/run-1", total: 1 })),
  };

  return {
    experiments: experimentService,
    workflows: workflowService,
    archiveWorkflow,
    monitors,
    workbenchObserver,
    runLoop,
    app: ExperimentApp.createForTesting({
      experiments: experimentService,
      runLookup,
      workflows: workflowService,
      workflowAuthoring,
      dataset: createApiFixture<DatasetApi>(),
      monitors,
      broadcast,
      permissions,
      people,
      modelCosts,
      slugify: (value: string) => value,
      runLoop,
      workbenchObserver,
      workflowEvaluations: createApiFixture<WorkflowEvaluationService>({}, "workflowEvaluations"),
    }),
  };
}

/** The single argument a stubbed method was called with. */
function firstCall(method: unknown): Record<string, unknown> {
  const mock = method as { mock: { calls: unknown[][] } };
  return mock.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("ExperimentApp", () => {
  describe("when nobody has run an experiment", () => {
    it("aggregates it to no runs rather than to a hole the caller fills", async () => {
      const { app } = harness();

      await expect(
        app.withRunAggregates({ projectId: "project-1", experiments: [experiment] }),
      ).resolves.toEqual([{ experiment, runsCount: 0, lastRunAt: null }]);
    });

    it("carries the aggregate through when the run store does have one", async () => {
      const { app } = harness({
        experiments: {
          getRunAggregates: vi.fn(async () => ({
            "experiment-1": { runsCount: 3, lastRunAt: 1700000000000 },
          })),
        },
      });

      await expect(
        app.withRunAggregates({ projectId: "project-1", experiments: [experiment] }),
      ).resolves.toEqual([{ experiment, runsCount: 3, lastRunAt: 1700000000000 }]);
    });
  });

  describe("when the page of experiments is empty", () => {
    it("asks the run store nothing", async () => {
      const { app, experiments } = harness();

      await expect(
        app.withRunAggregates({ projectId: "project-1", experiments: [] }),
      ).resolves.toEqual([]);
      expect(experiments.getRunAggregates).not.toHaveBeenCalled();
    });
  });

  describe("when a create sends no setup", () => {
    it("starts from a blank workbench carrying the name the caller gave", async () => {
      const { app, experiments } = harness();

      await app.createEvaluationsV3(
        { projectId: "project-1", name: "Support email classifier" },
        { kind: "user", id: "user-1" },
      );

      const sent = firstCall(experiments.createEvaluationsV3);
      expect(sent.state).toMatchObject({
        name: "Support email classifier",
        activeDatasetId: "test-data",
      });
    });

    it("names the blank workbench for the caller that named nothing", async () => {
      const { app, experiments } = harness();

      await app.createEvaluationsV3({ projectId: "project-1" }, { kind: "user", id: "user-1" });

      expect(firstCall(experiments.createEvaluationsV3).state).toMatchObject({
        name: "New Evaluation",
      });
    });
  });

  describe("when a create does send a setup", () => {
    it("saves that one rather than the blank default", async () => {
      const { app, experiments } = harness();

      await app.createEvaluationsV3(
        { projectId: "project-1", state: { name: "Mine", datasets: [] } },
        { kind: "user", id: "user-1" },
      );

      expect(firstCall(experiments.createEvaluationsV3).state).toEqual({
        name: "Mine",
        datasets: [],
      });
    });
  });

  describe("when a workbench write names its caller", () => {
    it("attributes a signed-in person by their user id", async () => {
      const { app, experiments } = harness();

      await app.saveWorkbenchState(
        { projectId: "project-1", id: "experiment-1", state: {} },
        { kind: "user", id: "user-1" },
      );

      expect(firstCall(experiments.saveWorkbenchState).actor).toEqual({
        userId: "user-1",
        label: "user",
      });
    });

    it("attributes a scoped API key to the person it was minted for", async () => {
      const { app, experiments } = harness();

      await app.saveWorkbenchState(
        { projectId: "project-1", id: "experiment-1", state: {} },
        {
          kind: "credential",
          credential: credentialPrincipalOfToken(
            apiKeyToken({ userId: "user-2", isLangySessionKey: false }),
          ),
        },
      );

      expect(firstCall(experiments.saveWorkbenchState).actor).toEqual({
        userId: "user-2",
        label: "api",
      });
    });

    it("attributes a legacy project key to the surface, since it names nobody", async () => {
      const { app, experiments } = harness();

      await app.saveWorkbenchState(
        { projectId: "project-1", id: "experiment-1", state: {} },
        { kind: "credential", credential: null },
      );

      expect(firstCall(experiments.saveWorkbenchState).actor).toEqual({ label: "api" });
    });

    it("labels an agent's edits so they read apart from a person's", async () => {
      const { app, experiments } = harness();

      await app.saveWorkbenchState(
        { projectId: "project-1", id: "experiment-1", state: {} },
        {
          kind: "credential",
          credential: credentialPrincipalOfToken(
            apiKeyToken({ userId: "user-2", isLangySessionKey: true }),
          ),
        },
      );

      expect(firstCall(experiments.saveWorkbenchState).actor).toEqual({
        userId: "user-2",
        label: "langy",
      });
    });

    it("stamps the same attribution on a commit and on a restore", async () => {
      const { app, experiments } = harness();

      await app.commitWorkbenchVersion(
        // `commitMessage` is required by the input and incidental to this
        // test, which is about the attribution the app stamps on either verb.
        { projectId: "project-1", id: "experiment-1", commitMessage: "a commit" },
        { kind: "user", id: "user-1" },
      );
      await app.restoreWorkbenchVersion(
        { projectId: "project-1", id: "experiment-1", version: 1 },
        { kind: "user", id: "user-1" },
      );

      expect(firstCall(experiments.commitWorkbenchVersion).actor).toEqual({
        userId: "user-1",
        label: "user",
      });
      expect(firstCall(experiments.restoreWorkbenchVersion).actor).toEqual({
        userId: "user-1",
        label: "user",
      });
    });
  });

  describe("when an experiment is archived", () => {
    /** @scenario Archiving cascades to the associated workflow and hard-deletes the monitor */
    it("archives the workflow it wrote versions into and drops its monitor", async () => {
      const { app, experiments, archiveWorkflow, monitors } = harness({
        experiments: { findById: vi.fn(async () => workflowBacked) },
      });

      await expect(app.archive({ id: "experiment-2", projectId: "project-1" })).resolves.toEqual({
        success: true,
      });
      expect(experiments.archive).toHaveBeenCalledWith({
        id: "experiment-2",
        projectId: "project-1",
      });
      expect(archiveWorkflow).toHaveBeenCalledWith({
        id: "workflow-1",
        projectId: "project-1",
      });
      expect(monitors.deleteForExperiment).toHaveBeenCalledWith({
        projectId: "project-1",
        experimentId: "experiment-2",
      });
    });

    /** @scenario Archiving without a workflow or monitor still succeeds */
    it("leaves the workflow alone when the experiment was backed by none", async () => {
      const { app, archiveWorkflow, monitors } = harness();

      await app.archive({ id: "experiment-1", projectId: "project-1" });

      expect(archiveWorkflow).not.toHaveBeenCalled();
      expect(monitors.deleteForExperiment).toHaveBeenCalled();
    });

    it("cascades into nothing when the project had no such experiment", async () => {
      const { app, archiveWorkflow, monitors } = harness({
        experiments: { findById: vi.fn(async () => null) },
      });

      await app.archive({ id: "ghost", projectId: "project-1" });

      expect(archiveWorkflow).not.toHaveBeenCalled();
      expect(monitors.deleteForExperiment).not.toHaveBeenCalled();
    });
  });

  describe("when the workflow behind an experiment is already gone", () => {
    it("reads as null, because an experiment outliving its workflow is ordinary", async () => {
      const { app } = harness({
        workflows: {
          getById: vi.fn(async () => {
            throw new WorkflowNotFoundError("workflow-1");
          }),
        },
      });

      await expect(
        app.findWorkflow({ id: "workflow-1", projectId: "project-1" }),
      ).resolves.toBeNull();
    });

    it("lets any other failure through rather than reading it as absence", async () => {
      const { app } = harness({
        workflows: {
          getById: vi.fn(async () => {
            throw new Error("the workflow store is unreachable");
          }),
        },
      });

      await expect(app.findWorkflow({ id: "workflow-1", projectId: "project-1" })).rejects.toThrow(
        "the workflow store is unreachable",
      );
    });
  });

  describe("when checking the archive path's source", () => {
    /** @scenario The delete-experiment code path does NOT contact ClickHouse */
    it("does not import getClickHouseClientForTenant", async () => {
      const src = await readFile(new URL("../experiment.app.ts", import.meta.url), "utf8");
      expect(src).not.toMatch(/getClickHouseClientForTenant/);
    });
  });
});

describe("given the workbench's own doors", () => {
  describe("when the family asks the App for what it declares", () => {
    it("answers every required member of the workbench REST family", () => {
      const { app } = harness();
      // The compiler is the assertion: the family's required application and
      // run-loop members must remain callable from the declared family.
      const answered: ExperimentV3RestApi = app;

      expect(typeof answered.abortWorkbenchRun).toBe("function");
      expect(typeof answered.readWorkbenchStateBySlug).toBe("function");
      expect(typeof answered.startSavedRun).toBe("function");
      expect(typeof answered.pollRun).toBe("function");
    });

    it("answers the setup doors with the application itself", () => {
      const { app } = harness();

      expect(app.experiments()).toBe(app);
    });

    it("hands the run doors the loop this deployment composed", () => {
      const { app, runLoop } = harness();

      expect(app.run()).toBe(runLoop);
    });
  });

  describe("when a run ends", () => {
    it("records the run and reports a failure through the observer", () => {
      const { app, workbenchObserver } = harness();
      const failure = new Error("nope");

      app.recordExperimentRan({
        userId: "user-1",
        projectId: "project-1",
        experimentId: "experiment-1",
        isFullRun: true,
      });
      app.reportError(failure, { projectId: "project-1" });

      expect(workbenchObserver.recordExperimentRan).toHaveBeenCalledWith({
        userId: "user-1",
        projectId: "project-1",
        experimentId: "experiment-1",
        isFullRun: true,
      });
      expect(workbenchObserver.reportError).toHaveBeenCalledWith(failure, {
        projectId: "project-1",
      });
    });
  });
});
