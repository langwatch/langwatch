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
