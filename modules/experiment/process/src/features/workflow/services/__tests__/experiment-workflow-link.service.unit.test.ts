import type { Dataset } from "@langwatch/dataset-contract";
import type { Experiment, SaveExperimentInput } from "@langwatch/experiment-contract";
import type { Monitor } from "@langwatch/monitor-contract";
import {
  parseStudioWorkflow,
  WorkflowNotFoundError,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  ExperimentWorkflowLinkService,
  type ExperimentWorkflowLinkServiceOptions,
} from "../experiment-workflow-link.service.ts";

type Options = ExperimentWorkflowLinkServiceOptions;
type ExperimentReads = Options["experiments"];
type WorkflowReads = Options["workflows"];
type WorkflowAuthoring = Options["workflowAuthoring"];
type DatasetWrites = Options["dataset"];
type MonitorWrites = Options["monitors"];
type MonitorInput = Parameters<MonitorWrites["upsertForExperiment"]>[0];

const NOW = new Date("2026-09-24T00:00:00.000Z");
const CALLER = { id: "user-1" };

const graph = parseStudioWorkflow({
  workflow_id: "workflow-1",
  spec_version: "1.4",
  name: "Support classifier",
  icon: "x",
  description: "x",
  version: "1",
  nodes: [],
  edges: [],
  state: {},
});

/** The graph a brand-new wizard sends: nothing links it to a workflow yet. */
const draftGraph = parseStudioWorkflow({
  spec_version: "1.4",
  name: "Support classifier",
  icon: "x",
  description: "x",
  version: "1",
  nodes: [],
  edges: [],
  state: {},
});

const MONITOR: Monitor = {
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
  sample: 0.5,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "experiment-1",
    projectId: "project-1",
    slug: "support-classifier",
    name: "Support classifier",
    type: "BATCH_EVALUATION_V2",
    workflowId: "workflow-1",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    workbenchState: { realTimeExecution: { sample: 0.5 } },
    workbenchVersion: 1,
    ...overrides,
  };
}

function workflow(
  dsl: NonNullable<WorkflowWithVersion["currentVersion"]>["dsl"],
): WorkflowWithVersion {
  return {
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
      dsl,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

class Experiments implements ExperimentReads {
  saved: SaveExperimentInput[] = [];
  constructor(private readonly row: Experiment) {}
  getById(): Promise<Experiment> {
    return Promise.resolve(this.row);
  }
  findNextDraftName(): Promise<string> {
    return Promise.resolve("Draft 1");
  }
  save(input: SaveExperimentInput): Promise<Experiment> {
    this.saved.push(input);
    return Promise.resolve(this.row);
  }
}

class Workflows implements WorkflowReads {
  constructor(private readonly found: WorkflowWithVersion | null) {}
  getById(input: { id: string }): Promise<WorkflowWithVersion> {
    return this.found
      ? Promise.resolve(this.found)
      : Promise.reject(new WorkflowNotFoundError(input.id));
  }
}

type CreateCall = Parameters<WorkflowAuthoring["create"]>;
type VersionCall = Parameters<WorkflowAuthoring["saveVersion"]>;

class Authoring implements WorkflowAuthoring {
  created: CreateCall[] = [];
  saved: VersionCall[] = [];
  get versions(): number {
    return this.saved.length;
  }
  create(...call: CreateCall): Promise<{ id: string }> {
    this.created.push(call);
    return Promise.resolve({ id: "workflow-new" });
  }
  saveVersion(...call: VersionCall): Promise<void> {
    this.saved.push(call);
    return Promise.resolve();
  }
}

class Datasets implements DatasetWrites {
  getByIds(): Promise<Dataset[]> {
    return Promise.resolve([]);
  }
  renameDataset(): Promise<Dataset> {
    return Promise.reject(new Error("no dataset is renamed here"));
  }
}

class Monitors implements MonitorWrites {
  written: MonitorInput[] = [];
  upsertForExperiment(input: MonitorInput): Promise<Monitor> {
    this.written.push(input);
    return Promise.resolve(MONITOR);
  }
}

function service({ row, found }: { row: Experiment; found: WorkflowWithVersion | null }) {
  const experiments = new Experiments(row);
  const authoring = new Authoring();
  const monitors = new Monitors();
  const links = ExperimentWorkflowLinkService.create({
    experiments,
    workflows: new Workflows(found),
    workflowAuthoring: authoring,
    dataset: new Datasets(),
    monitors,
    slugify: (value) => value.toLowerCase().replaceAll(" ", "-"),
  });
  return { links, experiments, authoring, monitors };
}

describe("ExperimentWorkflowLinkService", () => {
  describe("given a wizard experiment whose workflow no longer resolves", () => {
    /** @scenario "Saving a wizard experiment whose workflow is gone is refused" */
    it("refuses the save as experiment_workflow_not_found (404) and writes no version", async () => {
      const { links, authoring, experiments } = service({ row: experiment(), found: null });

      await expect(
        links.saveWithWorkflow(
          {
            projectId: "project-1",
            experimentId: "experiment-1",
            workbenchState: { name: "Support classifier" },
            dsl: graph,
          },
          CALLER,
        ),
      ).rejects.toMatchObject({ code: "experiment_workflow_not_found", httpStatus: 404 });
      expect(authoring.versions).toBe(0);
      expect(experiments.saved).toEqual([]);
    });
  });

  describe("given a new wizard experiment with no workflow yet", () => {
    /** @scenario "A new wizard experiment's first save creates its workflow with one version" */
    it("creates the workflow with the graph as its first version and writes no second", async () => {
      const { links, authoring, experiments } = service({ row: experiment(), found: null });

      await links.saveWithWorkflow(
        {
          projectId: "project-1",
          workbenchState: { name: "Support classifier" },
          dsl: draftGraph,
        },
        CALLER,
      );

      expect(authoring.created).toEqual([
        [
          {
            projectId: "project-1",
            dsl: expect.objectContaining({ name: "Support classifier - Workflow" }),
            commitMessage: "Autosaved",
            autoSaved: true,
          },
          CALLER,
        ],
      ]);
      expect(authoring.versions).toBe(0);
      expect(experiments.saved).toMatchObject([{ workflowId: "workflow-new" }]);
    });
  });

  describe("given a wizard experiment whose workflow resolves", () => {
    /** @scenario "A wizard experiment's later save writes a version into its existing workflow" */
    it("autosaves one version into that workflow, attributed to the caller", async () => {
      const { links, authoring } = service({ row: experiment(), found: workflow(graph) });

      await links.saveWithWorkflow(
        {
          projectId: "project-1",
          experimentId: "experiment-1",
          workbenchState: { name: "Support classifier" },
          dsl: graph,
        },
        CALLER,
      );

      expect(authoring.created).toEqual([]);
      expect(authoring.saved).toEqual([
        [
          expect.objectContaining({
            workflowId: "workflow-1",
            autoSaved: true,
            commitMessage: "Autosaved",
            setAsLatestVersion: true,
          }),
          CALLER,
        ],
      ]);
    });
  });

  describe("given a wizard experiment whose graph has no evaluator", () => {
    /** @scenario "A wizard experiment without an evaluator is not saved as a monitor" */
    it("refuses as experiment_not_ready_for_monitor (400) and writes no monitor", async () => {
      const { links, monitors } = service({
        row: experiment(),
        found: workflow({ version: "1", name: "Support classifier", nodes: [], edges: [] }),
      });

      await expect(
        links.saveAsMonitor({ projectId: "project-1", experimentId: "experiment-1" }),
      ).rejects.toMatchObject({ code: "experiment_not_ready_for_monitor", httpStatus: 400 });
      expect(monitors.written).toEqual([]);
    });
  });

  describe("given a wizard experiment whose graph has an evaluator", () => {
    /** @scenario "A wizard experiment with an evaluator is published as a monitor" */
    it("publishes the evaluator's check type and its parameters by identifier", async () => {
      const { links, monitors } = service({
        row: experiment(),
        found: workflow({
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
        }),
      });

      await links.saveAsMonitor({ projectId: "project-1", experimentId: "experiment-1" });

      expect(monitors.written[0]).toMatchObject({
        checkType: "langevals/llm_boolean",
        parameters: { model: "openai/gpt-5-mini" },
        sample: 0.5,
        executionMode: "ON_MESSAGE",
      });
    });
  });
});
