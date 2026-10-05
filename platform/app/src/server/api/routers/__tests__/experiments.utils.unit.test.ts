/**
 * getExperimentDatasetId resolves the Dataset column shown on the
 * experiments list. A workflow-backed experiment carries its dataset in the
 * DSL's entry node; an SDK-driven experiment (`experiments.init()`, no
 * workflow at all) has no DSL, so it falls back to `experiment.datasetId`
 * (issue #6411).
 *
 * @see ../experiments.utils.ts
 * @see ../experiments.ts — getAllForEvaluationsList
 */

import { describe, expect, it } from "vitest";
import { getExperimentDatasetId } from "../experiments.utils";

const workflowWithDataset = (datasetId: string) => ({
  nodes: [
    { type: "entry", data: { dataset: { id: datasetId } } },
    { type: "evaluator", data: {} },
  ],
});

describe("getExperimentDatasetId", () => {
  describe("given a workflow-backed experiment", () => {
    it("reads the dataset id from the DSL's entry node", () => {
      expect(
        getExperimentDatasetId({
          datasetId: null,
          workflow: {
            currentVersion: { dsl: workflowWithDataset("dataset_1") },
          },
        }),
      ).toBe("dataset_1");
    });

    it("prefers the workflow DSL over experiment.datasetId when both are present", () => {
      // The workflow DSL is what the Optimization Studio run actually used;
      // experiment.datasetId could be stale (e.g. carried over from before
      // the experiment was linked to a workflow).
      expect(
        getExperimentDatasetId({
          datasetId: "dataset_stale",
          workflow: {
            currentVersion: { dsl: workflowWithDataset("dataset_current") },
          },
        }),
      ).toBe("dataset_current");
    });
  });

  describe("given an SDK-driven experiment with no workflow", () => {
    it("falls back to experiment.datasetId", () => {
      expect(
        getExperimentDatasetId({ datasetId: "dataset_1", workflow: null }),
      ).toBe("dataset_1");
    });

    it("falls back to experiment.datasetId when workflow is undefined", () => {
      expect(
        getExperimentDatasetId({ datasetId: "dataset_1" }),
      ).toBe("dataset_1");
    });

    it("returns undefined when neither is set", () => {
      expect(
        getExperimentDatasetId({ datasetId: null, workflow: null }),
      ).toBeUndefined();
    });
  });

  describe("given a workflow with no entry node, or an entry node with no dataset", () => {
    it("falls back to experiment.datasetId rather than throwing", () => {
      expect(
        getExperimentDatasetId({
          datasetId: "dataset_1",
          workflow: {
            currentVersion: {
              dsl: { nodes: [{ type: "evaluator", data: {} }] },
            },
          },
        }),
      ).toBe("dataset_1");

      expect(
        getExperimentDatasetId({
          datasetId: "dataset_1",
          workflow: {
            currentVersion: {
              dsl: { nodes: [{ type: "entry", data: {} }] },
            },
          },
        }),
      ).toBe("dataset_1");
    });

    it("returns undefined when the DSL itself is missing", () => {
      expect(
        getExperimentDatasetId({
          datasetId: null,
          workflow: { currentVersion: { dsl: undefined } },
        }),
      ).toBeUndefined();
    });
  });
});
