/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { DatasetReference } from "../types";

describe("Saved datasets in workbench", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  describe("Adding saved dataset to workbench", () => {
    it("stores saved dataset reference with datasetId", () => {
      const store = useEvaluationsV3Store.getState();

      const savedDataset: DatasetReference = {
        id: "saved_abc123",
        name: "Production Samples",
        type: "saved",
        datasetId: "abc123",
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "output", name: "output", type: "string" },
        ],
      };

      store.addDataset(savedDataset);

      const state = useEvaluationsV3Store.getState();
      const addedDataset = state.datasets.find((d) => d.id === "saved_abc123");

      expect(addedDataset).toBeDefined();
      expect(addedDataset?.type).toBe("saved");
      expect(addedDataset?.datasetId).toBe("abc123");
    });

    it("can set active dataset to saved dataset", () => {
      const store = useEvaluationsV3Store.getState();

      const savedDataset: DatasetReference = {
        id: "saved_abc123",
        name: "Production Samples",
        type: "saved",
        datasetId: "abc123",
        columns: [{ id: "input", name: "input", type: "string" }],
      };

      store.addDataset(savedDataset);
      store.setActiveDataset("saved_abc123");

      expect(useEvaluationsV3Store.getState().activeDatasetId).toBe(
        "saved_abc123",
      );
    });
  });

  describe("Saved dataset with cached records", () => {
    it("stores cached records for saved dataset", () => {
      const store = useEvaluationsV3Store.getState();

      // Add saved dataset with cached records
      const savedDataset: DatasetReference = {
        id: "saved_abc123",
        name: "Production Samples",
        type: "saved",
        datasetId: "abc123",
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "output", name: "output", type: "string" },
        ],
        savedRecords: [
          { id: "rec1", input: "hello", output: "world" },
          { id: "rec2", input: "foo", output: "bar" },
        ],
      };

      store.addDataset(savedDataset);

      const state = useEvaluationsV3Store.getState();
      const addedDataset = state.datasets.find((d) => d.id === "saved_abc123");

      expect(addedDataset?.savedRecords).toHaveLength(2);
      expect(addedDataset?.savedRecords?.[0]).toEqual({
        id: "rec1",
        input: "hello",
        output: "world",
      });
    });

    it("getRowCount works with saved dataset records", () => {
      const store = useEvaluationsV3Store.getState();

      const savedDataset: DatasetReference = {
        id: "saved_abc123",
        name: "Production Samples",
        type: "saved",
        datasetId: "abc123",
        columns: [{ id: "input", name: "input", type: "string" }],
        savedRecords: [
          { id: "rec1", input: "hello" },
          { id: "rec2", input: "foo" },
          { id: "rec3", input: "baz" },
        ],
      };

      store.addDataset(savedDataset);

      const rowCount = useEvaluationsV3Store
        .getState()
        .getRowCount("saved_abc123");
      expect(rowCount).toBe(3);
    });

    it("getCellValue returns correct value for saved dataset", () => {
      const store = useEvaluationsV3Store.getState();

      const savedDataset: DatasetReference = {
        id: "saved_abc123",
        name: "Production Samples",
        type: "saved",
        datasetId: "abc123",
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "output", name: "output", type: "string" },
        ],
        savedRecords: [
          { id: "rec1", input: "hello", output: "world" },
          { id: "rec2", input: "foo", output: "bar" },
        ],
      };

      store.addDataset(savedDataset);

      // Get value at row 0, column "input"
      const value = useEvaluationsV3Store
        .getState()
        .getCellValue("saved_abc123", 0, "input");
      expect(value).toBe("hello");

      // Get value at row 1, column "output"
      const value2 = useEvaluationsV3Store
        .getState()
        .getCellValue("saved_abc123", 1, "output");
      expect(value2).toBe("bar");
    });

    it("getCellValue returns JSON-stringified value for object/array values", () => {
      const store = useEvaluationsV3Store.getState();

      const savedDataset: DatasetReference = {
        id: "saved_json",
        name: "JSON Dataset",
        type: "saved",
        datasetId: "json123",
        columns: [
          { id: "messages", name: "messages", type: "json" },
          { id: "metadata", name: "metadata", type: "json" },
        ],
        savedRecords: [
          {
            id: "rec1",
            messages: [
              { role: "user", content: "hello" },
              { role: "assistant", content: "hi there" },
            ],
            metadata: { key: "value", nested: { foo: "bar" } },
          },
        ],
      };

      store.addDataset(savedDataset);

      // Get array value - should be JSON stringified, not [object Object]
      const messagesValue = useEvaluationsV3Store
        .getState()
        .getCellValue("saved_json", 0, "messages");
      expect(messagesValue).toBe(
        '[{"role":"user","content":"hello"},{"role":"assistant","content":"hi there"}]',
      );
      expect(messagesValue).not.toContain("[object Object]");

      // Get object value - should be JSON stringified
      const metadataValue = useEvaluationsV3Store
        .getState()
        .getCellValue("saved_json", 0, "metadata");
      expect(metadataValue).toBe('{"key":"value","nested":{"foo":"bar"}}');
      expect(metadataValue).not.toContain("[object Object]");
    });

    it("getCellValue returns empty string for null/undefined values", () => {
      const store = useEvaluationsV3Store.getState();

      const savedDataset: DatasetReference = {
        id: "saved_nulls",
        name: "Null Dataset",
        type: "saved",
        datasetId: "null123",
        columns: [
          { id: "nullable", name: "nullable", type: "string" },
          { id: "missing", name: "missing", type: "string" },
        ],
        savedRecords: [{ id: "rec1", nullable: null }],
      };

      store.addDataset(savedDataset);

      // Null value should return empty string
      const nullValue = useEvaluationsV3Store
        .getState()
        .getCellValue("saved_nulls", 0, "nullable");
      expect(nullValue).toBe("");

      // Missing/undefined value should return empty string
      const missingValue = useEvaluationsV3Store
        .getState()
        .getCellValue("saved_nulls", 0, "missing");
      expect(missingValue).toBe("");
    });
  });

  describe("Editing saved dataset records", () => {
    it("updateSavedRecordValue updates record in cached data", () => {
      const store = useEvaluationsV3Store.getState();

      const savedDataset: DatasetReference = {
        id: "saved_abc123",
        name: "Production Samples",
        type: "saved",
        datasetId: "abc123",
        columns: [{ id: "input", name: "input", type: "string" }],
        savedRecords: [
          { id: "rec1", input: "hello" },
          { id: "rec2", input: "foo" },
        ],
      };

      store.addDataset(savedDataset);

      // Update value
      store.updateSavedRecordValue("saved_abc123", 0, "input", "updated value");

      const state = useEvaluationsV3Store.getState();
      const dataset = state.datasets.find((d) => d.id === "saved_abc123");

      expect(dataset?.savedRecords?.[0]?.input).toBe("updated value");
    });

    it("tracks pending changes for saved datasets", () => {
      const store = useEvaluationsV3Store.getState();

      const savedDataset: DatasetReference = {
        id: "saved_abc123",
        name: "Production Samples",
        type: "saved",
        datasetId: "abc123",
        columns: [{ id: "input", name: "input", type: "string" }],
        savedRecords: [{ id: "rec1", input: "hello" }],
      };

      store.addDataset(savedDataset);
      store.updateSavedRecordValue("saved_abc123", 0, "input", "changed");

      // Should track that rec1 has pending changes
      const pendingChanges =
        useEvaluationsV3Store.getState().pendingSavedChanges;
      expect(pendingChanges.abc123).toBeDefined();
      expect(pendingChanges.abc123?.rec1).toEqual({ input: "changed" });
    });
  });
});
