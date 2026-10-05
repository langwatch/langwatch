/**
 * @vitest-environment node
 * A create over `/api/experiments`, through the module's own application and experiment
 * service, onto a repository and a presence fabric that record what they were told.
 * Spec: specs/experiments-v3/workbench-versioning.feature.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { ExperimentModule } from "../../app/experiment.app.ts";
import type { ExperimentDspyRepository } from "../../repositories/experiment-dspy.repository.ts";
import type { ExperimentRunRepository } from "../../repositories/experiment-run.repository.ts";
import type { ExperimentRepository } from "../../repositories/experiment.repository.ts";
import { ExperimentFindOrCreateService } from "../../services/experiment-find-or-create.service.ts";
import { ExperimentWorkbenchPresenceUpdatesService } from "../../services/experiment-workbench-presence-updates.service.ts";
import { ExperimentService } from "../../services/experiment.service.ts";
import { mountExperimentRest, PROJECT_ID } from "./experiment-rest.harness.ts";

/** A create-capable experiment application whose store and presence fabric record their calls. */
function createOverRest() {
  const createWorkbenchState = vi.fn(
    async (input: Parameters<ExperimentRepository["createWorkbenchState"]>[0]) => ({
      id: input.id,
      slug: input.slug,
    }),
  );
  const publishProjectEvent = vi.fn(
    async (_input: { projectId: string; channel: string; event: string }) => undefined,
  );
  const repository = createApiFixture<ExperimentRepository>({
    createWorkbenchState,
    findSlugsByPrefix: async () => [],
  });
  const experiments = ExperimentService.create({
    repository,
    runRepository: createApiFixture<ExperimentRunRepository>(),
    dspyRepository: createApiFixture<ExperimentDspyRepository>(),
    slugify: (value) => value.toLowerCase().replaceAll(" ", "-"),
    newId: () => "experiment-new",
    references: {
      prompts: createApiFixture<PromptApi>(),
      agents: createApiFixture<AgentApi>(),
      evaluators: createApiFixture<EvaluatorApi>(),
      workflows: createApiFixture<WorkflowApi>(),
      dataset: createApiFixture<DatasetApi>(),
    },
    updates: ExperimentWorkbenchPresenceUpdatesService.create({
      presence: createApiFixture<PresenceApi>({ publishProjectEvent }),
      logger: createTestLogger().logger,
    }),
  });
  const application = ExperimentModule.createForTesting({
    experiments,
    runLookup: ExperimentFindOrCreateService.create(experiments),
    workflows: createApiFixture<WorkflowApi>(),
    workflowAuthoring: createApiFixture(),
    dataset: createApiFixture<DatasetApi>(),
    monitors: createApiFixture(),
    broadcast: createApiFixture(),
    permissions: createApiFixture(),
    people: createApiFixture(),
    modelCosts: createApiFixture(),
    slugify: (value) => value,
    workbenchTargetNames: async () => ({}),
    workbenchObserver: { recordExperimentRan: vi.fn(), reportError: vi.fn() },
    workflowEvaluations: createApiFixture(),
  });
  const { send } = mountExperimentRest({
    app: { createEvaluationsV3: (input, by) => application.createEvaluationsV3(input, by) },
  });

  return { send, createWorkbenchState, publishProjectEvent };
}

describe("given a caller with a project API key creating an experiment over REST", () => {
  describe("when it sends no setup", () => {
    /** @scenario "Creating an experiment over REST gives a workbench you can open" */
    it("stores version 1 of a workbench with one empty dataset", async () => {
      const { send, createWorkbenchState } = createOverRest();

      const response = await send("/api/experiments", { method: "POST", body: {} });

      expect(response.status).toBeLessThan(300);
      expect(await response.json()).toMatchObject({ id: "experiment-new", version: 1 });
      const stored = createWorkbenchState.mock.lastCall?.[0];
      expect(stored).toMatchObject({ projectId: PROJECT_ID });
      expect(stored).toMatchObject({
        state: {
          datasets: [{ inline: { records: { input: [], expected_output: [] } } }],
        },
      });
    });
  });

  describe("when it creates an experiment", () => {
    /** @scenario "A create over REST tells the tenant the list moved" */
    it("publishes an experiment update naming the new experiment on the tenant's fabric", async () => {
      const { send, publishProjectEvent } = createOverRest();

      await send("/api/experiments", { method: "POST", body: {} });

      expect(publishProjectEvent).toHaveBeenCalledTimes(1);
      const published = publishProjectEvent.mock.lastCall?.[0];
      expect(published).toMatchObject({ projectId: PROJECT_ID, channel: "experiment_updated" });
      expect(JSON.parse(published?.event ?? "null")).toMatchObject({
        event: "experiment_updated",
        experimentId: "experiment-new",
        version: 1,
      });
    });
  });
});
