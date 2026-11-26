import type { Dataset } from "@langwatch/dataset-contract";
import type { Experiment, ExperimentRun } from "@langwatch/experiment-contract";
import type { WorkflowWithVersion } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  ExperimentListingService,
  type ExperimentListingServiceOptions,
} from "../experiment-listing.service.ts";

type Options = ExperimentListingServiceOptions;
type ExperimentReads = Options["experiments"];
type WorkflowLinks = Options["links"];
type DatasetReads = Options["dataset"];

class NoExperiments implements ExperimentReads {
  getById(): Promise<Experiment> {
    return Promise.reject(new Error("no experiment is read by id here"));
  }
  getBySlug(): Promise<Experiment> {
    return Promise.reject(new Error("no experiment is read by slug here"));
  }
  list(): Promise<Experiment[]> {
    return Promise.resolve([]);
  }
  listRuns(): Promise<Record<string, ExperimentRun[]>> {
    return Promise.resolve({});
  }
}

class NoWorkflows implements WorkflowLinks {
  findWorkflow(): Promise<WorkflowWithVersion | null> {
    return Promise.resolve(null);
  }
}

class NoDatasets implements DatasetReads {
  getByIds(): Promise<Dataset[]> {
    return Promise.resolve([]);
  }
}

describe("ExperimentListingService", () => {
  describe("given a lookup with neither an experiment id nor a slug", () => {
    /** @scenario "A lookup naming neither an id nor a slug is refused" */
    it("refuses as validation_error (400)", async () => {
      const listing = ExperimentListingService.create({
        experiments: new NoExperiments(),
        links: new NoWorkflows(),
        dataset: new NoDatasets(),
      });

      await expect(listing.getByIdOrSlug({ projectId: "project-1" })).rejects.toMatchObject({
        code: "validation_error",
        httpStatus: 400,
      });
    });
  });
});

/** About 1 MB of saved state: a workbench with an inline dataset, or a workflow's DSL. */
const largeBlob = () => ({
  rows: Array.from({ length: 2_000 }, (_, index) => ({
    question: `question ${index} `.repeat(25),
  })),
});

const experimentOf = ({
  index,
  workflowId = null,
  workbenchState = null,
}: {
  index: number;
  workflowId?: string | null;
  workbenchState?: Experiment["workbenchState"];
}): Experiment => ({
  id: `experiment-${index}`,
  name: `Experiment ${index}`,
  type: workflowId ? "BATCH_EVALUATION_V2" : "EVALUATIONS_V3",
  slug: `experiment-${index}`,
  projectId: "project-1",
  workflowId,
  createdAt: new Date(1_000 + index),
  updatedAt: new Date(2_000 + index),
  archivedAt: null,
  workbenchState,
  workbenchVersion: 3,
});

class StoredExperiments extends NoExperiments {
  constructor(private readonly experiments: Experiment[]) {
    super();
  }
  override list(): Promise<Experiment[]> {
    return Promise.resolve(this.experiments);
  }
  override listRuns(): Promise<Record<string, ExperimentRun[]>> {
    return Promise.resolve({
      "experiment-0": [
        {
          experimentId: "experiment-0",
          runId: "run-1",
          workflowVersion: null,
          timestamps: { createdAt: 5_000, updatedAt: 6_000, finishedAt: 6_000 },
          summary: { evaluations: { exact: { name: "Exact match", averageScore: 0.8 } } },
        },
      ],
    });
  }
}

class LargeWorkflows implements WorkflowLinks {
  readonly read: string[] = [];
  findWorkflow({ id }: { id: string }): Promise<WorkflowWithVersion | null> {
    this.read.push(id);
    const at = new Date(1_000);
    return Promise.resolve({
      id,
      projectId: "project-1",
      name: "Support agent",
      icon: null,
      description: null,
      latestVersionId: `${id}-v1`,
      currentVersionId: `${id}-v1`,
      publishedId: null,
      publishedById: null,
      copiedFromWorkflowId: null,
      isEvaluator: false,
      isComponent: false,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
      currentVersion: {
        id: `${id}-v1`,
        workflowId: id,
        projectId: "project-1",
        version: "1",
        autoSaved: false,
        commitMessage: "first",
        authorId: null,
        parentId: null,
        dsl: { version: "1", name: "Support agent", nodes: [], edges: [], state: largeBlob() },
        createdAt: at,
        updatedAt: at,
      },
    });
  }
}

class OneDataset implements DatasetReads {
  getByIds(): Promise<Dataset[]> {
    return Promise.resolve([{ id: "dataset-1", name: "Support questions" } as Dataset]);
  }
}

describe("ExperimentListingService.listForEvaluations", () => {
  describe("given experiments whose saved workbench and workflow are large", () => {
    /** @scenario "The experiments list carries only what its table draws" */
    it("answers rows of a few hundred bytes with no saved state", async () => {
      const listing = ExperimentListingService.create({
        experiments: new StoredExperiments([
          experimentOf({ index: 0, workbenchState: { task: "llm_app", ...largeBlob() } }),
          experimentOf({ index: 1, workflowId: "workflow-1" }),
        ]),
        links: new LargeWorkflows(),
        dataset: new OneDataset(),
      });

      const page = await listing.listForEvaluations({ projectId: "project-1" });

      expect(JSON.stringify(page).length).toBeLessThan(2_000);
      const [workbenchRow, workflowRow] = page.experiments;
      expect(workbenchRow).toMatchObject({
        name: "Experiment 0",
        type: "EVALUATIONS_V3",
        workbenchState: { task: "llm_app" },
        runsSummary: { count: 1, primaryMetric: { name: "Exact match" } },
        updatedAt: 5_000,
      });
      expect(workflowRow).toMatchObject({
        workflowId: "workflow-1",
        workbenchState: null,
      });
      for (const row of page.experiments) {
        expect(row).not.toHaveProperty("workflow");
        expect(row).not.toHaveProperty("workbenchVersion");
      }
    });
  });

  describe("given a project with 30 workflow experiments", () => {
    /** @scenario "The experiments list reads workflows only for the experiments on its page" */
    it("reads the workflows of the 25 on the first page only", async () => {
      const workflows = new LargeWorkflows();
      const listing = ExperimentListingService.create({
        experiments: new StoredExperiments(
          Array.from({ length: 30 }, (_, index) =>
            experimentOf({ index, workflowId: `workflow-${index}` }),
          ),
        ),
        links: workflows,
        dataset: new OneDataset(),
      });

      const page = await listing.listForEvaluations({ projectId: "project-1", pageSize: 25 });

      expect(page.totalHits).toBe(30);
      expect(page.experiments).toHaveLength(25);
      expect(workflows.read).toHaveLength(25);
    });
  });
});
