/**
 * @see specs/experiment-workbench-updates.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import {
  type Experiment,
  experimentUpdateSignalSchema,
  StaleWorkbenchStateError,
} from "@langwatch/experiment-contract";
import type { PresenceApi, PresenceProjectEvent } from "@langwatch/presence-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import type { ExperimentDspyRepository } from "../../repositories/experiment-dspy.repository.ts";
import type { ExperimentRunRepository } from "../../repositories/experiment-run.repository.ts";
import type { ExperimentRepository } from "../../repositories/experiment.repository.ts";
import { ExperimentSlugService } from "../experiment-slug.service.ts";
import { ExperimentWorkbenchPresenceUpdatesService } from "../experiment-workbench-presence-updates.service.ts";
import { ExperimentWorkbenchReferencesService } from "../experiment-workbench-references.service.ts";
import {
  ExperimentWorkbenchService,
  type ExperimentWorkbenchUpdates,
} from "../experiment-workbench.service.ts";
import { ExperimentService } from "../experiment.service.ts";

const validState = {
  name: "My evaluation",
  datasets: [],
  activeDatasetId: "dataset-1",
  evaluators: [],
  targets: [],
};

type Notice = Parameters<ExperimentWorkbenchUpdates["publish"]>[0];

function recordingUpdates(): { updates: ExperimentWorkbenchUpdates; notices: Notice[] } {
  const notices: Notice[] = [];
  return {
    notices,
    updates: {
      publish: async (notice) => {
        notices.push(notice);
      },
    },
  };
}

const references = {
  prompts: createApiFixture<PromptApi>(),
  agents: createApiFixture<AgentApi>(),
  evaluators: createApiFixture<EvaluatorApi>(),
  workflows: createApiFixture<WorkflowApi>(),
  dataset: createApiFixture<DatasetApi>(),
};

function workbenchService(input: {
  repository: ExperimentRepository;
  updates: ExperimentWorkbenchUpdates;
}): ExperimentWorkbenchService {
  return ExperimentWorkbenchService.create({
    repository: input.repository,
    newId: () => "generated-id",
    updates: input.updates,
    slugs: ExperimentSlugService.create({
      repository: { findSlugsByPrefix: async () => [] },
      newId: () => "generated-id",
    }),
    references: ExperimentWorkbenchReferencesService.create({ references }),
    draftNames: { findNextDraftName: async () => "Draft 1" },
  });
}

const savedRepository = (): ExperimentRepository =>
  createApiFixture<ExperimentRepository>({
    resolveWorkbenchSaveTarget: async () => ({
      kind: "update",
      state: {
        experimentId: "experiment_1",
        slug: "my-evaluation",
        name: "My evaluation",
        state: null,
        version: 3,
        updatedAt: new Date(0),
      },
    }),
    writeWorkbenchState: async () => ({
      kind: "saved",
      experimentId: "experiment_1",
      slug: "my-evaluation",
      version: 4,
    }),
  });

describe("given a workbench save", () => {
  describe("when it lands on an existing experiment", () => {
    /** @scenario A workbench save announces the version it landed at */
    it("publishes the saved version with the actor and the run that wrote it", async () => {
      const { updates, notices } = recordingUpdates();
      const service = workbenchService({ repository: savedRepository(), updates });

      await service.saveWorkbenchState({
        projectId: "project_1",
        id: "experiment_1",
        state: validState,
        expectedVersion: 3,
        actor: { userId: "user_1", label: "user", runId: "run_1" },
      });

      expect(notices).toEqual([
        {
          projectId: "project_1",
          experimentId: "experiment_1",
          slug: "my-evaluation",
          version: 4,
          actorLabel: "user",
          runId: "run_1",
        },
      ]);
    });
  });

  describe("when the save is stale", () => {
    /** @scenario A refused save announces nothing */
    it("publishes nothing", async () => {
      const { updates, notices } = recordingUpdates();
      const repository = createApiFixture<ExperimentRepository>({
        resolveWorkbenchSaveTarget: async () => ({
          kind: "update",
          state: {
            experimentId: "experiment_1",
            slug: "my-evaluation",
            name: "My evaluation",
            state: null,
            version: 5,
            updatedAt: new Date(0),
          },
        }),
        writeWorkbenchState: async () => ({ kind: "stale", currentVersion: 5 }),
      });
      const service = workbenchService({ repository, updates });

      await expect(
        service.saveWorkbenchState({
          projectId: "project_1",
          id: "experiment_1",
          state: validState,
          expectedVersion: 3,
          actor: { label: "user" },
        }),
      ).rejects.toBeInstanceOf(StaleWorkbenchStateError);
      expect(notices).toEqual([]);
    });
  });

  describe("when it creates the experiment", () => {
    /** @scenario A workbench create announces version one */
    it("publishes version 1 for the new experiment", async () => {
      const { updates, notices } = recordingUpdates();
      const repository = createApiFixture<ExperimentRepository>({
        createWorkbenchState: async (input) => ({ id: input.id, slug: input.slug }),
      });
      const service = workbenchService({ repository, updates });

      await service.createEvaluationsV3({
        projectId: "project_1",
        state: validState,
        actor: { label: "langy" },
      });

      expect(notices).toEqual([
        {
          projectId: "project_1",
          experimentId: "generated-id",
          slug: "rated-id",
          version: 1,
          actorLabel: "langy",
        },
      ]);
    });
  });
});

const workflowExperiment: Experiment = {
  id: "experiment_workflow_1",
  name: "Workflow eval",
  type: "EVALUATIONS_V3",
  slug: "workflow-eval",
  projectId: "project_1",
  workflowId: "workflow_1",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  workbenchState: null,
  workbenchVersion: 7,
};

describe("given a workflow evaluation refreshing its experiment", () => {
  describe("when the experiment already exists", () => {
    /** @scenario A workflow evaluation refresh announces the bumped version as the api */
    it("publishes the bumped counter attributed to the api", async () => {
      const { updates, notices } = recordingUpdates();
      const repository = createApiFixture<ExperimentRepository>({
        findForWorkflow: async () => workflowExperiment,
        updateWorkbenchState: async () => ({ version: 8 }),
      });
      const service = ExperimentService.create({
        repository,
        runRepository: createApiFixture<ExperimentRunRepository>(),
        dspyRepository: createApiFixture<ExperimentDspyRepository>(),
        slugify: (value) => value,
        newId: () => "generated-id",
        references,
        updates,
      });

      await service.findOrCreateForWorkflow({
        projectId: "project_1",
        workflowId: "workflow_1",
        name: "Workflow eval",
        workbenchState: validState,
      });

      expect(notices).toEqual([
        {
          projectId: "project_1",
          experimentId: "experiment_workflow_1",
          slug: "workflow-eval",
          version: 8,
          actorLabel: "api",
        },
      ]);
    });
  });
});

describe("given the presence publisher for workbench updates", () => {
  const presenceRecording = () => {
    const events: PresenceProjectEvent[] = [];
    const presence = createApiFixture<PresenceApi>({
      publishProjectEvent: async (event) => {
        events.push(event);
      },
    });
    return { presence, events };
  };

  describe("when a notice is published", () => {
    /** @scenario A notice rides presence on the notice's own project only */
    it("sends one experiment_updated event to the notice's project, carrying the signal and no state", async () => {
      const { presence, events } = presenceRecording();
      const service = ExperimentWorkbenchPresenceUpdatesService.create({
        presence,
        logger: { warn: vi.fn() },
      });

      await service.publish({
        projectId: "project_1",
        experimentId: "experiment_1",
        slug: "my-evaluation",
        version: 4,
        actorLabel: "user",
        runId: "run_1",
      });

      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event?.projectId).toBe("project_1");
      expect(event?.channel).toBe("experiment_updated");
      expect(event?.tier).toBeUndefined();
      expect(experimentUpdateSignalSchema.parse(JSON.parse(event?.event ?? ""))).toEqual({
        event: "experiment_updated",
        experimentId: "experiment_1",
        slug: "my-evaluation",
        version: 4,
        actorLabel: "user",
        runId: "run_1",
      });
    });

    it("leaves the run out of the signal when no run wrote the version", async () => {
      const { presence, events } = presenceRecording();
      const service = ExperimentWorkbenchPresenceUpdatesService.create({
        presence,
        logger: { warn: vi.fn() },
      });

      await service.publish({
        projectId: "project_2",
        experimentId: "experiment_2",
        slug: "other",
        version: 1,
        actorLabel: "api",
      });

      expect(events.map((event) => event.projectId)).toEqual(["project_2"]);
      expect(JSON.parse(events[0]?.event ?? "")).not.toHaveProperty("runId");
    });
  });

  describe("when the fabric refuses the publish", () => {
    /** @scenario A failed publish is logged and never undoes the save */
    it("logs a warning and resolves", async () => {
      const warn = vi.fn();
      const presence = createApiFixture<PresenceApi>({
        publishProjectEvent: async () => {
          throw new Error("fabric down");
        },
      });
      const service = ExperimentWorkbenchPresenceUpdatesService.create({
        presence,
        logger: { warn },
      });

      await expect(
        service.publish({
          projectId: "project_1",
          experimentId: "experiment_1",
          slug: "my-evaluation",
          version: 4,
          actorLabel: "user",
        }),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    });
  });
});
