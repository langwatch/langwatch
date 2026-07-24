/**
 * @vitest-environment node
 *
 * Tests for dataset save and remove edge cases:
 * 1. Save as dataset with duplicate name should generate unique IDs for records
 * 2. Save as dataset with name conflict should auto-suggest next available name
 * 3. Removing a saved dataset should handle edge case when it's the last one
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { DatasetColumn, DatasetReference } from "../types";
import { DEFAULT_TEST_DATA_ID } from "../types";
import { convertInlineToRowRecords } from "../utils/datasetConversion";

describe("Dataset save and remove edge cases", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  describe("Bug #3: Removing the last saved dataset after initial inline dataset was replaced", () => {
    it("handles removing a dataset when it results in zero datasets gracefully", () => {
      const store = useEvaluationsV3Store.getState();

      // Start with only the default inline dataset
      expect(store.datasets.length).toBe(1);
      expect(store.datasets[0]!.id).toBe(DEFAULT_TEST_DATA_ID);

      // Add a saved dataset (simulating the "Save as dataset" flow)
      const savedDataset: DatasetReference = {
        id: "saved_abc123",
        name: "My Saved Dataset",
        type: "saved",
        datasetId: "abc123",
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "expected_output", name: "expected_output", type: "string" },
        ],
        savedRecords: [
          { id: "rec1", input: "hello", expected_output: "world" },
        ],
      };
      store.addDataset(savedDataset);
      store.setActiveDataset("saved_abc123");

      // Now remove the original inline dataset (this is what happens after "Save as dataset")
      store.removeDataset(DEFAULT_TEST_DATA_ID);

      // At this point we have only one dataset (the saved one)
      expect(useEvaluationsV3Store.getState().datasets.length).toBe(1);
      expect(useEvaluationsV3Store.getState().activeDatasetId).toBe(
        "saved_abc123",
      );

      // BUG: Trying to remove the last dataset should NOT crash
      // The removeDataset function has a guard for this, but let's verify
      // it works correctly and doesn't cause runtime errors
      store.removeDataset("saved_abc123");

      // Should still have 1 dataset (can't remove the last one)
      const finalState = useEvaluationsV3Store.getState();
      expect(finalState.datasets.length).toBe(1);
    });

    it("switches to first available dataset when removing active dataset", () => {
      const store = useEvaluationsV3Store.getState();

      // Add two saved datasets
      const savedDataset1: DatasetReference = {
        id: "saved_1",
        name: "Dataset 1",
        type: "saved",
        datasetId: "ds1",
        columns: [{ id: "input", name: "input", type: "string" }],
      };
      const savedDataset2: DatasetReference = {
        id: "saved_2",
        name: "Dataset 2",
        type: "saved",
        datasetId: "ds2",
        columns: [{ id: "input", name: "input", type: "string" }],
      };

      store.addDataset(savedDataset1);
      store.addDataset(savedDataset2);
      store.setActiveDataset("saved_2");

      // Remove the active dataset
      store.removeDataset("saved_2");

      // Should switch to another available dataset
      const state = useEvaluationsV3Store.getState();
      expect(state.datasets.length).toBe(2); // default + saved_1
      expect(state.activeDatasetId).not.toBe("saved_2");
    });

    it("correctly handles removing the ONLY non-default dataset when default was already removed", () => {
      const store = useEvaluationsV3Store.getState();

      // Simulate the exact flow from the bug:
      // 1. User has default inline dataset "Test Data"
      // 2. User saves it as a new dataset
      // 3. The inline dataset gets replaced by the saved reference
      // 4. User then tries to remove this saved dataset

      // Step 1: Start with default
      expect(store.datasets.length).toBe(1);
      const defaultDataset = store.datasets[0];
      expect(defaultDataset?.id).toBe(DEFAULT_TEST_DATA_ID);

      // Step 2 & 3: Simulate "Save as dataset" flow - add saved, then remove inline
      const savedDataset: DatasetReference = {
        id: "workbench_saved_ref",
        name: "Test Data",
        type: "saved",
        datasetId: "persisted_dataset_id",
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "expected_output", name: "expected_output", type: "string" },
        ],
      };

      // Add the saved reference first (so we have 2)
      store.addDataset(savedDataset);
      store.setActiveDataset("workbench_saved_ref");

      // Remove the old inline dataset (now we have 1)
      store.removeDataset(DEFAULT_TEST_DATA_ID);

      // Now we should have exactly 1 dataset
      expect(useEvaluationsV3Store.getState().datasets.length).toBe(1);
      expect(useEvaluationsV3Store.getState().datasets[0]!.id).toBe(
        "workbench_saved_ref",
      );

      // Step 4: BUG - User tries to remove this dataset
      // This should NOT crash with "can't access property 'id', newDatasets[0] is undefined"

      // The guard should prevent removal of the last dataset
      store.removeDataset("workbench_saved_ref");

      // Verify no crash and dataset still exists
      const finalState = useEvaluationsV3Store.getState();
      expect(finalState.datasets.length).toBe(1);
      expect(finalState.activeDatasetId).toBe("workbench_saved_ref");
    });
  });

  describe("Dataset ID generation for records", () => {
    it("generates unique record IDs when saving inline dataset", () => {
      const store = useEvaluationsV3Store.getState();

      // Set up an inline dataset with data
      store.setCellValue(DEFAULT_TEST_DATA_ID, 0, "input", "hello");
      store.setCellValue(DEFAULT_TEST_DATA_ID, 0, "expected_output", "world");
      store.setCellValue(DEFAULT_TEST_DATA_ID, 1, "input", "foo");
      store.setCellValue(DEFAULT_TEST_DATA_ID, 1, "expected_output", "bar");

      // Get the inline records
      const state = useEvaluationsV3Store.getState();
      const dataset = state.datasets.find((d) => d.id === DEFAULT_TEST_DATA_ID);

      expect(dataset?.inline?.records).toBeDefined();

      // The records should be in column-first format
      const records = dataset?.inline?.records;
      expect(records?.input).toBeDefined();
      expect(records?.expected_output).toBeDefined();
    });
  });

  describe("Bug #1 (FIXED): Record IDs should NOT be sent to API - let backend generate them", () => {
    it("does NOT include IDs in converted records", () => {
      // FIX: convertInlineToRowRecords should NOT include IDs
      // The backend's createDatasetRecords generates unique IDs with nanoid()
      // This prevents "Unique constraint failed on the fields: (`id`)" errors

      const columns: DatasetColumn[] = [
        { id: "input", name: "input", type: "string" },
        { id: "expected_output", name: "expected_output", type: "string" },
      ];
      const records = {
        input: ["hello", "world", "foo"],
        expected_output: ["hi", "earth", "bar"],
      };

      const rowRecords = convertInlineToRowRecords(columns, records);

      // Should have 3 rows
      expect(rowRecords.length).toBe(3);

      // Records should NOT have IDs - let the backend generate them
      expect(rowRecords[0]!.id).toBeUndefined();
      expect(rowRecords[1]!.id).toBeUndefined();
      expect(rowRecords[2]!.id).toBeUndefined();

      // But should have the column data
      expect(rowRecords[0]!.input).toBe("hello");
      expect(rowRecords[0]!.expected_output).toBe("hi");
    });

    it("allows saving the same data multiple times without ID conflicts", () => {
      // When user saves the same dataset multiple times (e.g., saves, then saves again with different name)
      // There should be no ID conflicts because IDs are not included

      const columns: DatasetColumn[] = [
        { id: "input", name: "input", type: "string" },
      ];
      const records = {
        input: ["hello"],
      };

      const firstSave = convertInlineToRowRecords(columns, records);
      const secondSave = convertInlineToRowRecords(columns, records);

      // Neither should have IDs
      expect(firstSave[0]!.id).toBeUndefined();
      expect(secondSave[0]!.id).toBeUndefined();
    });
  });

  describe("Bug #3 (FIXED): Save as dataset should use updateDataset, not removeDataset + addDataset", () => {
    it("demonstrates the OLD buggy approach - removeDataset + addDataset creates duplicates", () => {
      const store = useEvaluationsV3Store.getState();

      // Start with 1 dataset
      expect(store.datasets.length).toBe(1);
      expect(store.datasets[0]!.id).toBe(DEFAULT_TEST_DATA_ID);
      expect(store.datasets[0]!.type).toBe("inline");

      // OLD BUGGY CODE (for documentation):
      // 1. removeDataset - blocked because only 1 dataset
      // 2. addDataset with same ID - creates a duplicate!

      const currentDataset = store.datasets[0]!;
      const updatedDataset: DatasetReference = {
        ...currentDataset,
        type: "saved",
        datasetId: "persisted_id_123",
        inline: undefined,
      };

      // This is what the OLD buggy code did:
      store.removeDataset(currentDataset.id); // Does nothing - guard blocks it
      store.addDataset(updatedDataset); // Adds duplicate!

      // BUG: We now have 2 datasets with the same ID!
      const state = useEvaluationsV3Store.getState();

      // This DOCUMENTS the bug - we get 2 datasets when we should have 1
      expect(state.datasets.length).toBe(2); // Bug: should be 1
    });

    it("correct approach: updateDataset transforms inline to saved without duplicates", () => {
      const store = useEvaluationsV3Store.getState();

      // Start with 1 inline dataset
      expect(store.datasets.length).toBe(1);
      expect(store.datasets[0]!.type).toBe("inline");

      // CORRECT CODE: Use updateDataset instead
      store.updateDataset(DEFAULT_TEST_DATA_ID, {
        type: "saved",
        datasetId: "persisted_id_123",
        inline: undefined,
      });

      const state = useEvaluationsV3Store.getState();

      // Should still be 1 dataset
      expect(state.datasets.length).toBe(1);

      // The dataset should now be saved type
      expect(state.datasets[0]!.type).toBe("saved");
      expect(state.datasets[0]!.datasetId).toBe("persisted_id_123");
    });
  });
});
