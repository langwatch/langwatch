import type { Dataset } from "@langwatch/dataset-contract";
import type { Experiment, SaveExperimentInput } from "@langwatch/experiment-contract";
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
  mayManageEvaluations(): Promise<boolean> {
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
