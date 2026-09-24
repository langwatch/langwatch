import { createApiFixture } from "@langwatch/api-fixture";
/** @vitest-environment node */
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import {
  ExperimentDspyStepNotFoundError,
  ExperimentIdOrSlugRequiredError,
  ExperimentNotFoundError,
  ExperimentNotReadyForMonitorError,
  ExperimentPermissionDeniedError,
  ExperimentTypeMismatchError,
  ExperimentWorkflowNotFoundError,
  type Experiment,
  type ExperimentApi,
  type ExperimentPublishedMonitor,
  type PersistedEvaluationsV3State,
} from "@langwatch/experiment-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { experimentTrpcTransport } from "../experiment.trpc.ts";

type TestContext = { actor: { id: string } };

const NOW = new Date("2026-09-10T00:00:00.000Z");
const STATE = {
  name: "Support classifier",
  datasets: [],
  activeDatasetId: "test-data",
  evaluators: [],
  targets: [],
} satisfies PersistedEvaluationsV3State;
const EXPERIMENT: Experiment = {
  id: "experiment-1",
  projectId: "project-1",
  slug: "support-classifier",
  name: "Support classifier",
  type: "EVALUATIONS_V3",
  workflowId: "workflow-1",
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  workbenchState: STATE,
  workbenchVersion: 7,
};
const MONITOR: ExperimentPublishedMonitor = {
  id: "monitor-1",
  projectId: "project-1",
  experimentId: "experiment-1",
  evaluatorId: null,
  checkType: "langevals/llm_boolean",
  name: "Support classifier",
  slug: "support-classifier",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [],
  parameters: {},
  mappings: { mapping: {}, expansions: [] },
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const WORKFLOW_DSL = {
  workflow_id: "workflow-1",
  spec_version: "1.4",
  name: "Support classifier",
  icon: "x",
  description: "x",
  version: "1",
  nodes: [],
  edges: [],
  state: {},
};

function mount(app: ExperimentApi) {
  const trpc = initTRPC.context<TestContext>().create();
  const members: TrpcRuntimeMembers<TestContext> = {
    identity: { caller: (context) => ({ actor: { type: "user", id: context.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member restricted"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members,
  }).mount(experimentTrpcTransport, () => app);

  return router.createCaller({ actor: { id: "user-1" } });
}

describe("given the experiments tRPC wire", () => {
  describe("when a workbench is opened by slug", () => {
    it("returns the full experiment row with the versioned workbench state", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          getBySlug: async () => EXPERIMENT,
          getWorkbenchState: async () => ({
            experimentId: EXPERIMENT.id,
            slug: EXPERIMENT.slug,
            name: EXPERIMENT.name,
            state: STATE,
            version: 7,
            updatedAt: NOW,
          }),
        }),
      );

      await expect(
        caller.getEvaluationsV3BySlug({
          projectId: "project-1",
          experimentSlug: "support-classifier",
        }),
      ).resolves.toMatchObject({
        id: "experiment-1",
        projectId: "project-1",
        name: "Support classifier",
        workbenchState: STATE,
        workbenchVersion: 7,
        version: 7,
      });
    });
  });

  describe("when a wizard is saved as a monitor", () => {
    it("returns the monitor row written by the monitor application", async () => {
      const saveAsMonitor = vi.fn(async () => MONITOR);
      const caller = mount(createApiFixture<ExperimentApi>({ saveAsMonitor }));

      await expect(
        caller.saveAsMonitor({ projectId: "project-1", experimentId: "experiment-1" }),
      ).resolves.toEqual(MONITOR);
      expect(saveAsMonitor).toHaveBeenCalledWith({
        projectId: "project-1",
        experimentId: "experiment-1",
      });
    });
  });

  describe("when the experiment is missing or of another kind", () => {
    it("answers a missing experiment as NOT_FOUND with its own message", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          getBySlug: async () => {
            throw new ExperimentNotFoundError("support-classifier");
          },
          getWorkbenchState: async () => {
            throw new ExperimentNotFoundError("support-classifier");
          },
        }),
      );

      await expect(
        caller.getEvaluationsV3BySlug({
          projectId: "project-1",
          experimentSlug: "support-classifier",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Experiment not found: support-classifier",
      });
    });

    it("answers an experiment of another kind as BAD_REQUEST with its own message", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          archive: async () => {
            throw new ExperimentTypeMismatchError();
          },
        }),
      );

      await expect(
        caller.deleteExperiment({ projectId: "project-1", experimentId: "experiment-1" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This experiment is not an evaluation workbench",
      });
    });
  });

  describe("when a refusal moved from the router into the module", () => {
    it("keeps a wizard experiment's missing workflow as NOT_FOUND", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          saveWithWorkflow: async () => {
            throw new ExperimentWorkflowNotFoundError("experiment-1");
          },
        }),
      );

      await expect(
        caller.saveExperiment({
          projectId: "project-1",
          experimentId: "experiment-1",
          workbenchState: {},
          dsl: WORKFLOW_DSL,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("keeps an experiment not ready for a monitor as BAD_REQUEST", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          saveAsMonitor: async () => {
            throw new ExperimentNotReadyForMonitorError("experiment-1");
          },
        }),
      );

      await expect(
        caller.saveAsMonitor({ projectId: "project-1", experimentId: "experiment-1" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("keeps a lookup with neither id nor slug as BAD_REQUEST", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          getByIdOrSlug: async () => {
            throw new ExperimentIdOrSlugRequiredError();
          },
        }),
      );

      await expect(
        caller.getExperimentBySlugOrId({ projectId: "project-1" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("keeps a copy from a source the caller cannot manage as UNAUTHORIZED", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          copyToProject: async () => {
            throw new ExperimentPermissionDeniedError({
              permission: "evaluations:manage",
              message: "You do not have permission to manage evaluations in the source project",
            });
          },
        }),
      );

      await expect(
        caller.copy({
          experimentId: "experiment-1",
          projectId: "project-2",
          sourceProjectId: "project-1",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("keeps a copy whose experiment workflow is gone as NOT_FOUND", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          copyToProject: async () => {
            throw new ExperimentWorkflowNotFoundError("experiment-1");
          },
        }),
      );

      await expect(
        caller.copy({
          experimentId: "experiment-1",
          projectId: "project-2",
          sourceProjectId: "project-1",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("keeps a copy whose new workflow cannot be read as INTERNAL_SERVER_ERROR", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          copyToProject: async () => {
            throw new Error("Failed to create workflow");
          },
        }),
      );

      await expect(
        caller.copy({
          experimentId: "experiment-1",
          projectId: "project-2",
          sourceProjectId: "project-1",
        }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    });

    it("answers a missing DSPy step as NOT_FOUND without a router remap", async () => {
      const caller = mount(
        createApiFixture<ExperimentApi>({
          getBySlug: async () => EXPERIMENT,
          getDspyStep: async () => {
            throw new ExperimentDspyStepNotFoundError("run-1:3");
          },
        }),
      );

      await expect(
        caller.getExperimentDSPyStep({
          projectId: "project-1",
          experimentSlug: "support-classifier",
          runId: "run-1",
          index: "3",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
