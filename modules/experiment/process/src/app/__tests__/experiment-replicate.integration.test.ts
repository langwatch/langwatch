/**
 * Replicating an EVALUATIONS_V3 experiment, installed the way the worker installs it
 * over the memory tier: copy, open as the editor does, save.
 * @see specs/experiments-v3/experiment-replicate.feature
 * @vitest-environment node
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { Dataset, DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { ExperimentApi, WorkbenchMissingReferenceError } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { experimentProcessModule } from "../../experiment.module.ts";

const SOURCE = "project_source";
const OTHER = "project_other";
const USER = { id: "user_1" };

const bareState = (overrides: Record<string, unknown> = {}) => ({
  name: "Original",
  datasets: [],
  activeDatasetId: "dataset-1",
  evaluators: [],
  targets: [],
  ...overrides,
});

async function boot() {
  const datasets = new Map<string, Dataset>();
  let copies = 0;
  const eventing = new EventSourcing({
    enabled: false,
    participation: "consume",
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const runtime = await createApp({ role: "worker" })
    .withModules([experimentProcessModule])
    .withStores(memoryStores())
    .withEventing(eventing)
    .withConfig({
      experiment: {
        blockLocalHttpCalls: false,
        allowedProxyHosts: [],
        runConcurrency: 10,
        publicBaseUrl: undefined,
        isSaas: false,
      },
    })
    .withObservability((observability) => observability.withLogging(createTestLogger().logger))
    .provide({
      workflow: createApiFixture<WorkflowApi>({}),
      dataset: createApiFixture<DatasetApi>({
        getByIds: async ({ projectId, datasetIds }) =>
          datasetIds.flatMap((id) => {
            const found = datasets.get(`${projectId}/${id}`);
            return found ? [found] : [];
          }),
        copyDataset: async ({ targetProjectId }) => {
          copies += 1;
          const id = `copied_${copies}`;
          const copy = { id, projectId: targetProjectId } as Dataset;
          datasets.set(`${targetProjectId}/${id}`, copy);
          return copy;
        },
      }),
      monitor: createApiFixture<MonitorApi>({}),
      agent: createApiFixture<AgentApi>({}),
      evaluator: createApiFixture<EvaluatorApi>({}),
      prompt: createApiFixture<PromptApi>({
        getAllPrompts: async ({ projectId }) =>
          projectId === SOURCE
            ? ([{ id: "prompt_1", handle: null }] as Awaited<
                ReturnType<PromptApi["getAllPrompts"]>
              >)
            : [],
      }),
      authz: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
      presence: createApiFixture<PresenceApi>({ publishProjectEvent: async () => {} }),
      project: createApiFixture<ProjectApi>({}),
      entitlement: createApiFixture<EntitlementApi>({}),
      evaluation: createApiFixture<EvaluationApi>({}),
      "api-key": createApiFixture<ApiKeyApi>({}),
      "stored-object": createApiFixture<StoredObjectApi>({}),
      trace: createApiFixture<TraceApi>({}),
      "model-provider": createApiFixture<ModelProviderApi>({}),
      "data-retention": createApiFixture<DataRetentionApi>({}),
    })
    .boot();
  const api = runtime.service(ExperimentApi);

  const seed = async ({
    projectId = SOURCE,
    state,
  }: {
    projectId?: string;
    state: Record<string, unknown>;
  }) => api.createEvaluationsV3({ projectId, state }, { kind: "user", id: USER.id });
  const seedSavedDataset = (id: string) => {
    datasets.set(`${SOURCE}/${id}`, { id, projectId: SOURCE } as Dataset);
  };
  const replicate = async ({
    experimentId,
    projectId = SOURCE,
    copyDatasets = false,
  }: {
    experimentId: string;
    projectId?: string;
    copyDatasets?: boolean;
  }) =>
    (
      await api.copyToProject(
        { experimentId, projectId, sourceProjectId: SOURCE, copyDatasets },
        USER,
      )
    ).experiment;
  /** Opens the copy the way the editor does (row identity first), edits the name and saves. */
  const openAndSave = async ({
    projectId,
    experimentId,
    edit,
  }: {
    projectId: string;
    experimentId: string;
    edit: string;
  }) => {
    const row = await api.getWorkbenchState({ projectId, id: experimentId });
    return api.saveWorkbenchState(
      { projectId, id: row.experimentId, state: { ...row.state, name: edit } },
      { kind: "user", id: USER.id },
    );
  };
  const read = (projectId: string, id: string) => api.getById({ projectId, id });
  const stateOf = (row: { workbenchState: unknown }) =>
    row.workbenchState as Record<string, unknown>;

  return { runtime, seed, seedSavedDataset, replicate, openAndSave, read, stateOf };
}

describe("replicating an experiment", () => {
  describe("given an experiment whose saved state holds its own id, slug and results", () => {
    /** @scenario "A replicated experiment does not carry the original's identity" */
    it("drops identity and results and names the copy", async () => {
      const t = await boot();
      try {
        const original = await t.seed({
          state: bareState({ experimentId: "x", experimentSlug: "x", results: { runId: "run-1" } }),
        });
        const copy = await t.replicate({ experimentId: original.experimentId });
        const row = await t.read(SOURCE, copy.id);
        const state = t.stateOf(row);

        expect(state.experimentId).toBeUndefined();
        expect(state.experimentSlug).toBeUndefined();
        expect(state.results).toBeUndefined();
        expect(row.name).toBe("Original (copy)");
        expect(state.name).toBe("Original (copy)");
      } finally {
        await t.runtime.stop();
      }
    });
  });

  describe("given a replicated experiment", () => {
    /** @scenario "Saving a replicated experiment leaves the original untouched" */
    it("changes the copy and not the original", async () => {
      const t = await boot();
      try {
        const original = await t.seed({ state: bareState() });
        const copy = await t.replicate({ experimentId: original.experimentId });
        const before = await t.read(SOURCE, original.experimentId);

        await t.openAndSave({ projectId: SOURCE, experimentId: copy.id, edit: "Edited copy" });

        const after = await t.read(SOURCE, original.experimentId);
        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(t.stateOf(await t.read(SOURCE, copy.id)).name).toBe("Edited copy");
      } finally {
        await t.runtime.stop();
      }
    });
  });

  describe("given a copy whose saved state still holds the original's id and slug", () => {
    /** @scenario "Opening a copy made before the fix edits the copy" */
    it("changes the copy and not the original", async () => {
      const t = await boot();
      try {
        const original = await t.seed({ state: bareState() });
        const oldCopy = await t.seed({
          state: bareState({
            experimentId: original.experimentId,
            experimentSlug: original.slug,
            name: "Old copy",
          }),
        });
        const before = await t.read(SOURCE, original.experimentId);

        await t.openAndSave({
          projectId: SOURCE,
          experimentId: oldCopy.experimentId,
          edit: "Edited old copy",
        });

        const after = await t.read(SOURCE, original.experimentId);
        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(t.stateOf(await t.read(SOURCE, oldCopy.experimentId)).name).toBe("Edited old copy");
      } finally {
        await t.runtime.stop();
      }
    });
  });

  describe("given an experiment replicated into another project", () => {
    /** @scenario "A replicated experiment in another project can be saved" */
    it("persists the edit in that project", async () => {
      const t = await boot();
      try {
        const original = await t.seed({ state: bareState() });
        const copy = await t.replicate({ experimentId: original.experimentId, projectId: OTHER });

        await t.openAndSave({
          projectId: OTHER,
          experimentId: copy.id,
          edit: "Edited cross-project",
        });

        const saved = await t.read(OTHER, copy.id);
        expect(saved.projectId).toBe(OTHER);
        expect(t.stateOf(saved).name).toBe("Edited cross-project");
      } finally {
        await t.runtime.stop();
      }
    });
  });

  describe("given an experiment with a saved dataset replicated with its datasets copied", () => {
    /** @scenario "A copy into another project with its dataset copied can be saved" */
    it("saves against the copied dataset and leaves the original unchanged", async () => {
      const t = await boot();
      try {
        t.seedSavedDataset("dataset_saved");
        const original = await t.seed({
          state: bareState({
            datasets: [
              {
                id: "saved-ds-1",
                name: "Saved",
                type: "saved",
                datasetId: "dataset_saved",
                columns: [],
              },
            ],
            activeDatasetId: "saved-ds-1",
          }),
        });
        const before = await t.read(SOURCE, original.experimentId);

        const copy = await t.replicate({
          experimentId: original.experimentId,
          projectId: OTHER,
          copyDatasets: true,
        });
        await t.openAndSave({
          projectId: OTHER,
          experimentId: copy.id,
          edit: "Edited with dataset",
        });

        const saved = t.stateOf(await t.read(OTHER, copy.id)) as {
          datasets: { datasetId?: string }[];
        };
        expect(saved.datasets[0]?.datasetId).toBe("copied_1");
        const after = await t.read(SOURCE, original.experimentId);
        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
      } finally {
        await t.runtime.stop();
      }
    });
  });

  describe("given an experiment whose target uses a prompt, replicated into another project", () => {
    /** @scenario "Saving a copy in another project that still uses a source-project prompt is refused" */
    it("refuses the save and leaves the original unchanged", async () => {
      const t = await boot();
      try {
        const original = await t.seed({
          state: bareState({
            targets: [{ id: "target-1", type: "prompt", promptId: "prompt_1", mappings: {} }],
          }),
        });
        const before = await t.read(SOURCE, original.experimentId);
        const copy = await t.replicate({ experimentId: original.experimentId, projectId: OTHER });

        const error = await t
          .openAndSave({
            projectId: OTHER,
            experimentId: copy.id,
            edit: "Edited with source prompt",
          })
          .then(
            () => undefined,
            (e: unknown) => e,
          );

        expect(error).toBeInstanceOf(WorkbenchMissingReferenceError);
        expect(error).toMatchObject({
          code: "experiment_workbench_missing_reference",
          meta: { refType: "prompt", refId: "prompt_1" },
        });
        const after = await t.read(SOURCE, original.experimentId);
        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
      } finally {
        await t.runtime.stop();
      }
    });
  });
});
