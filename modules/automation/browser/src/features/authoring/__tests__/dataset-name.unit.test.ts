import { describe, expect, it, vi } from "vitest";

import type { DatasetSlice } from "../model/dataset-slice.ts";

vi.mock("../../../behavior/automation-api.ts", () => ({ api: {} }));

const { INITIAL_DRAFT } = await import("../ui/sections/draft-model.ts");
const { default: datasetClient } = await import("../ui/sections/dataset.client.tsx");
const { withDatasetName } = await import("../model/dataset-name.ts");

const MAPPING = {
  mapping: { input: { source: "input", key: "", subkey: "" } },
  expansions: [],
};

function datasetDraft(slice: DatasetSlice) {
  return {
    ...INITIAL_DRAFT,
    action: "ADD_TO_DATASET" as const,
    slices: { ...INITIAL_DRAFT.slices, ADD_TO_DATASET: slice },
  };
}

describe("dataset delivery summary", () => {
  describe("given the dataset list has named the chosen dataset", () => {
    /** @scenario "The dataset delivery summary names the dataset" */
    it("names the dataset, never its id", () => {
      const draft = withDatasetName({
        draft: datasetDraft({ datasetId: "dataset_abc123", mapping: MAPPING }),
        datasets: [{ id: "dataset_abc123", name: "Refusals" }],
      });

      const line = datasetClient.summary(draft.slices.ADD_TO_DATASET, {
        name: "Collect refusals",
      });

      expect(line).toBe("Collect refusals → dataset Refusals");
      expect(line).not.toContain("dataset_abc123");
    });
  });

  describe("given the chosen dataset changed after it was named", () => {
    it("does not show the old dataset's name or the new id", () => {
      const line = datasetClient.summary(
        {
          datasetId: "dataset_new",
          mapping: MAPPING,
          namedDataset: { id: "dataset_old", name: "Old" },
        },
        { name: "Collect" },
      );

      expect(line).toBe("Collect → a dataset");
    });
  });

  describe("given the draft is already named for its dataset", () => {
    it("returns the same draft so nothing is dispatched", () => {
      const draft = datasetDraft({
        datasetId: "dataset_abc123",
        mapping: MAPPING,
        namedDataset: { id: "dataset_abc123", name: "Refusals" },
      });

      expect(
        withDatasetName({
          draft,
          datasets: [{ id: "dataset_abc123", name: "Refusals" }],
        }),
      ).toBe(draft);
    });
  });
});
