import type { Dataset } from "@langwatch/dataset-contract";
import type { Experiment, SaveExperimentInput } from "@langwatch/experiment-contract";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import type { StudioWorkflow, WorkflowWithVersion } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  ExperimentCopyService,
  type ExperimentCopyServiceOptions,
} from "../experiment-copy.service.ts";

type Options = ExperimentCopyServiceOptions;
type ExperimentReads = Options["experiments"];
type WorkflowLinks = Options["links"];
type WorkflowAuthoring = Options["workflowAuthoring"];
type DatasetCopies = Options["dataset"];
type Permissions = Options["permissions"];

const NOW = new Date("2026-09-24T00:00:00.000Z");

const SOURCE: Experiment = {
  id: "experiment-1",
  projectId: "source-project",
  slug: "support-classifier",
  name: "Support classifier",
  type: "BATCH_EVALUATION_V2",
  workflowId: "workflow-1",
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  workbenchState: {},
  workbenchVersion: 1,
};

class Experiments implements ExperimentReads {
  reads = 0;
  saved: SaveExperimentInput[] = [];
  getById(): Promise<Experiment> {
    this.reads += 1;
    return Promise.resolve(SOURCE);
  }
  save(input: SaveExperimentInput): Promise<Experiment> {
    this.saved.push(input);
    return Promise.resolve(SOURCE);
  }
}

class GoneWorkflows implements WorkflowLinks {
  findWorkflow(): Promise<WorkflowWithVersion | null> {
    return Promise.resolve(null);
  }
}

class Authoring implements WorkflowAuthoring {
  saveVersion(): Promise<void> {
    return Promise.reject(new Error("no version is written here"));
  }
  copyWithDatasets(): Promise<{ workflowId: string; dsl: StudioWorkflow }> {
    return Promise.reject(new Error("no workflow is copied here"));
  }
}

class Datasets implements DatasetCopies {
  copyDataset(): Promise<Dataset> {
    return Promise.reject(new Error("no dataset is copied here"));
  }
}

class Probe implements Permissions {
  constructor(private readonly allowed: boolean) {}
  hasPermission(): Promise<boolean> {
    return Promise.resolve(this.allowed);
  }
}

function service({ allowed }: { allowed: boolean }) {
  const experiments = new Experiments();
  const copies = ExperimentCopyService.create({
    experiments,
    links: new GoneWorkflows(),
    workflowAuthoring: new Authoring(),
    dataset: new Datasets(),
    permissions: new Probe(allowed),
    slugify: (value) => value,
  });
  return { copies, experiments };
}

/** A V3 source whose saved state still holds its own identity and results. */
const V3_SOURCE: Experiment = {
  ...SOURCE,
  type: "EVALUATIONS_V3",
  workflowId: null,
  workbenchState: {
    experimentId: SOURCE.id,
    experimentSlug: SOURCE.slug,
    name: SOURCE.name,
    datasets: [],
    results: { runId: "run-1" },
  },
};

class V3Experiments extends Experiments {
  override getById(): Promise<Experiment> {
    this.reads += 1;
    return Promise.resolve(V3_SOURCE);
  }
}

const COPY = {
  experimentId: "experiment-1",
  projectId: "target-project",
  sourceProjectId: "source-project",
};

describe("ExperimentCopyService", () => {
  describe("given the caller cannot manage evaluations in the source project", () => {
    /** @scenario "Copying from a project the caller cannot manage evaluations in is refused" */
    it("refuses as permission_denied (401) before reading the source", async () => {
      const { copies, experiments } = service({ allowed: false });

      await expect(copies.copyToProject(COPY, { id: "user-1" })).rejects.toMatchObject({
        code: "permission_denied",
        httpStatus: 401,
      });
      expect(experiments.reads).toBe(0);
    });
  });

  describe("given an experiment whose saved state holds its own id, slug and results", () => {
    /** @scenario "A replicated experiment does not carry the original's identity" */
    it("saves a copy without them, named as the copy", async () => {
      const experiments = new V3Experiments();
      const copies = ExperimentCopyService.create({
        experiments,
        links: new GoneWorkflows(),
        workflowAuthoring: new Authoring(),
        dataset: new Datasets(),
        permissions: new Probe(true),
        slugify: (value) => value,
      });

      await copies.copyToProject(COPY, { id: "user-1" });

      const [saved] = experiments.saved;
      expect(saved?.name).toBe("Support classifier (copy)");
      expect(saved?.workbenchState).toEqual({ name: "Support classifier (copy)", datasets: [] });
    });
  });

  describe("given a workbench whose prompt target is on Instant Evals", () => {
    /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
    it("refuses the copy, naming the target, and saves nothing", async () => {
      const experiments = new (class extends Experiments {
        override getById(): Promise<Experiment> {
          return Promise.resolve({
            ...V3_SOURCE,
            workbenchState: {
              ...(V3_SOURCE.workbenchState as object),
              targets: [
                {
                  id: "target_1",
                  type: "prompt",
                  localPromptConfig: { llm: { model: INSTANT_EVAL_JUDGE_MODEL_ID } },
                },
              ],
            },
          });
        }
      })();
      const copies = ExperimentCopyService.create({
        experiments,
        links: new GoneWorkflows(),
        workflowAuthoring: new Authoring(),
        dataset: new Datasets(),
        permissions: new Probe(true),
        slugify: (value) => value,
      });

      await expect(
        copies.copyToProject({ ...COPY, copyDatasets: true }, { id: "user-1" }),
      ).rejects.toMatchObject({
        code: "instant_eval_judge_only_model",
        meta: { places: ["target 1"] },
      });
      expect(experiments.saved).toEqual([]);
    });

    /** @scenario "A workbench whose evaluators judge on Instant Evals still saves" */
    it("copies a workbench whose only Instant Evals is an evaluator column", async () => {
      const experiments = new (class extends Experiments {
        override getById(): Promise<Experiment> {
          return Promise.resolve({
            ...V3_SOURCE,
            workbenchState: {
              ...(V3_SOURCE.workbenchState as object),
              evaluators: [
                {
                  id: "judge",
                  localEvaluatorConfig: { settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID } },
                },
              ],
            },
          });
        }
      })();
      const copies = ExperimentCopyService.create({
        experiments,
        links: new GoneWorkflows(),
        workflowAuthoring: new Authoring(),
        dataset: new Datasets(),
        permissions: new Probe(true),
        slugify: (value) => value,
      });

      await copies.copyToProject(COPY, { id: "user-1" });

      expect(experiments.saved).toHaveLength(1);
    });
  });

  describe("given a workflow-backed experiment whose workflow no longer resolves", () => {
    /** @scenario "Copying a workflow experiment whose workflow is gone is refused" */
    it("refuses as experiment_workflow_not_found (404) and saves nothing", async () => {
      const { copies, experiments } = service({ allowed: true });

      await expect(copies.copyToProject(COPY, { id: "user-1" })).rejects.toMatchObject({
        code: "experiment_workflow_not_found",
        httpStatus: 404,
      });
      expect(experiments.saved).toEqual([]);
    });
  });
});
