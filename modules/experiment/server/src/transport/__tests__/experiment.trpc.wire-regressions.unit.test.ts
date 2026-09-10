/** @vitest-environment node */
import { createTrpcRuntime, type TrpcRuntimePorts } from "@langwatch/api/trpc";
import type {
  Experiment,
  ExperimentApi,
  ExperimentPublishedMonitor,
  PersistedEvaluationsV3State,
} from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowWithVersion } from "@langwatch/workflow-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { experimentTrpcTransport } from "../experiment.trpc.ts";

type TestContext = { actor: { id: string } };

const NOW = new Date("2026-09-10T00:00:00.000Z");
const STATE: PersistedEvaluationsV3State = {
  name: "Support classifier",
  datasets: [],
  activeDatasetId: "test-data",
  evaluators: [],
  targets: [],
};
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
const WORKFLOW: WorkflowWithVersion = {
  id: "workflow-1",
  projectId: "project-1",
  name: "Support classifier",
  icon: null,
  description: null,
  latestVersionId: "version-1",
  currentVersionId: "version-1",
  publishedId: null,
  publishedById: null,
  copiedFromWorkflowId: null,
  isEvaluator: false,
  isComponent: false,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  currentVersion: {
    id: "version-1",
    workflowId: "workflow-1",
    projectId: "project-1",
    version: "1",
    autoSaved: false,
    commitMessage: "Initial",
    authorId: "user-1",
    parentId: null,
    dsl: {
      version: "1",
      name: "Support classifier",
      nodes: [
        {
          type: "evaluator",
          data: {
            evaluator: "langevals/llm_boolean",
            parameters: [{ identifier: "model", value: "openai/gpt-5-mini" }],
          },
        },
      ],
      edges: [],
    },
    createdAt: NOW,
    updatedAt: NOW,
  },
};

function mount(app: ExperimentApi) {
  const trpc = initTRPC.context<TestContext>().create();
  const ports: TrpcRuntimePorts<TestContext> = {
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
    ports,
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
      const publishAsMonitor = vi.fn(async () => MONITOR);
      const caller = mount(
        createApiFixture<ExperimentApi>({
          getById: async () => EXPERIMENT,
          findWorkflow: async () => WORKFLOW,
          publishAsMonitor,
        }),
      );

      await expect(
        caller.saveAsMonitor({ projectId: "project-1", experimentId: "experiment-1" }),
      ).resolves.toEqual(MONITOR);
      expect(publishAsMonitor).toHaveBeenCalledOnce();
    });
  });
});
