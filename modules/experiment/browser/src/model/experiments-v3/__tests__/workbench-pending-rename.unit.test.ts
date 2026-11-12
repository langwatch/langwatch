/**
 * A saved dataset's cell edit still waiting for its sync follows a column rename
 * that lands before the sync runs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";

const DATASET_ID = "saved_ds-1";
const store = () => useEvaluationsV3Store.getState();

beforeEach(() => {
  store().reset();
  store().addDataset({
    id: DATASET_ID,
    name: "Saved",
    type: "saved",
    datasetId: "ds-1",
    columns: [
      { id: "input_0", name: "input", type: "string" },
      { id: "test_1", name: "test", type: "string" },
    ],
    savedRecords: [{ id: "rec-1", input: "question one", test: "hello" }],
  });
});

afterEach(() => store().reset());

describe("given a cell edit on a saved dataset that has not synced yet", () => {
  describe("when the columns drawer renames that cell's column before the sync", () => {
    /** @scenario "A pending saved-dataset cell edit follows a column rename" */
    it("queues the edit under the new column name", () => {
      store().setCellValue({ datasetId: DATASET_ID, row: 0, columnId: "test_1", value: "edited" });
      expect(store().pendingSavedChanges["ds-1"]).toEqual({ "rec-1": { test: "edited" } });

      store().applyDatasetColumnsEdit({
        datasetId: DATASET_ID,
        edited: {
          datasetId: "ds-1",
          name: "Saved",
          columnTypes: [
            { id: "input_0", name: "input", type: "string" },
            { id: "test_1", name: "test2", type: "string" },
          ],
        },
      });

      expect(store().pendingSavedChanges["ds-1"]).toEqual({ "rec-1": { test2: "edited" } });
      const dataset = store().datasets.find((d) => d.id === DATASET_ID);
      expect(dataset?.savedRecords?.[0]).toEqual({
        id: "rec-1",
        input: "question one",
        test2: "edited",
      });
    });

    /** @scenario "A pending saved-dataset cell edit follows a column rename" */
    it("drops the edit's value for a column the same save deleted", () => {
      store().setCellValue({ datasetId: DATASET_ID, row: 0, columnId: "test_1", value: "edited" });

      store().applyDatasetColumnsEdit({
        datasetId: DATASET_ID,
        edited: {
          datasetId: "ds-1",
          name: "Saved",
          columnTypes: [{ id: "input_0", name: "input", type: "string" }],
        },
      });

      expect(store().pendingSavedChanges).not.toHaveProperty("ds-1");
    });
  });
});
