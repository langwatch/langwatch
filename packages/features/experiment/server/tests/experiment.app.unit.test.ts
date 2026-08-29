/**
 * @vitest-environment node
 *
 * The experiment application: the rules that moved off its two doors onto it.
 *
 *   - attributing a workbench write to its caller, stamped in four places
 *     before this (three in tRPC, one in REST);
 *   - what an experiment nobody has run aggregates to, defaulted twice in the
 *     REST list and read routes;
 *   - what a create with no setup starts from;
 *   - reading a workflow that may already be gone, caught in four handlers;
 *   - what archiving an experiment cascades into.
 *
 * The services are stubbed. Nothing here speaks HTTP or tRPC.
 */
import type { ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { Experiment, ExperimentService } from "@langwatch/experiment-contract";
import { WorkflowNotFoundError, type WorkflowService } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";
import { ExperimentApp } from "../src/app/experiment.app";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const experiment = {
  id: "experiment-1",
  projectId: "project-1",
  slug: "support-email-classifier",
  name: "Support email classifier",
  type: "EVALUATIONS_V3",
  workflowId: null,
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as Experiment;

const workflowBacked = { ...experiment, id: "experiment-2", workflowId: "workflow-1" };

/** A scoped API key, as the process resolves one. */
const apiKeyToken = ({
  userId,
  isLangySessionKey,
}: {
  userId: string | null;
  isLangySessionKey: boolean;
}): ResolvedApiKeyToken => ({
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
  experiments?: Record<string, unknown>;
  workflows?: Record<string, unknown>;
} = {}) {
  const experimentService = {
    tryGetById: vi.fn(async () => experiment),
    archive: vi.fn(async () => ({ success: true as const })),
    getRunAggregates: vi.fn(async () => ({})),
    saveWorkbenchState: vi.fn(async () => ({ experimentId: "experiment-1", slug: "s", version: 1 })),
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
  } as unknown as ExperimentService;

  const workflowService = {
    getById: vi.fn(async () => ({ id: "workflow-1" })),
    archive: vi.fn(async () => undefined),
    ...workflows,
  } as unknown as WorkflowService;

  const monitors = { deleteForExperiment: vi.fn(async () => undefined) };
  const broadcast = {
    getTenantEmitter: vi.fn(),
    cleanupTenantEmitter: vi.fn(),
  };

  return {
    experiments: experimentService,
    workflows: workflowService,
    monitors,
    app: ExperimentApp.create({
      experiments: experimentService,
      workflows: workflowService,
      dataset: {} as unknown as DatasetService,
      monitors,
      broadcast,
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
        { kind: "credential", resolved: apiKeyToken({ userId: "user-2", isLangySessionKey: false }) },
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
        { kind: "credential", resolved: null },
      );

      expect(firstCall(experiments.saveWorkbenchState).actor).toEqual({ label: "api" });
    });

    it("labels an agent's edits so they read apart from a person's", async () => {
      const { app, experiments } = harness();

      await app.saveWorkbenchState(
        { projectId: "project-1", id: "experiment-1", state: {} },
        { kind: "credential", resolved: apiKeyToken({ userId: "user-2", isLangySessionKey: true }) },
      );

      expect(firstCall(experiments.saveWorkbenchState).actor).toEqual({
        userId: "user-2",
        label: "langy",
      });
    });

    it("stamps the same attribution on a commit and on a restore", async () => {
      const { app, experiments } = harness();

      await app.commitWorkbenchVersion(
        { projectId: "project-1", id: "experiment-1" },
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
    it("archives the workflow it wrote versions into and drops its monitor", async () => {
      const { app, experiments, workflows, monitors } = harness({
        experiments: { tryGetById: vi.fn(async () => workflowBacked) },
      });

      await expect(app.archive({ id: "experiment-2", projectId: "project-1" })).resolves.toEqual({
        success: true,
      });
      expect(experiments.archive).toHaveBeenCalledWith({
        id: "experiment-2",
        projectId: "project-1",
      });
      expect(workflows.archive).toHaveBeenCalledWith({
        id: "workflow-1",
        projectId: "project-1",
      });
      expect(monitors.deleteForExperiment).toHaveBeenCalledWith({
        projectId: "project-1",
        experimentId: "experiment-2",
      });
    });

    it("leaves the workflow alone when the experiment was backed by none", async () => {
      const { app, workflows, monitors } = harness();

      await app.archive({ id: "experiment-1", projectId: "project-1" });

      expect(workflows.archive).not.toHaveBeenCalled();
      expect(monitors.deleteForExperiment).toHaveBeenCalled();
    });

    it("cascades into nothing when the project had no such experiment", async () => {
      const { app, workflows, monitors } = harness({
        experiments: { tryGetById: vi.fn(async () => null) },
      });

      await app.archive({ id: "ghost", projectId: "project-1" });

      expect(workflows.archive).not.toHaveBeenCalled();
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
        app.tryGetWorkflow({ id: "workflow-1", projectId: "project-1" }),
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

      await expect(
        app.tryGetWorkflow({ id: "workflow-1", projectId: "project-1" }),
      ).rejects.toThrow("the workflow store is unreachable");
    });
  });
});
