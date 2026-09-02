import { describe, expect, it } from "vitest";
import type { Field } from "@langwatch/workflow-contract";
import {
  datasetColumnTypeToFieldType,
  datasetColumnsToFields,
  datasetDatabaseRecordsToInMemoryDataset,
  fieldsToDatasetColumns,
  inMemoryDatasetToNodeDataset,
  trainTestSplit,
  transposeColumnsFirstToRowsFirstWithId,
  transpostRowsFirstToColumnsFirstWithoutId,
  tryToMapPreviousColumnsToNewColumns,
} from "../model/studio-dataset.utils";

describe("studio dataset column/field type conversion", () => {
  describe("when a dataset column is typed image (URL)", () => {
    it("converts the column to the image field type, not str", () => {
      expect(datasetColumnTypeToFieldType("image")).toBe("image");
    });
  });

  describe("when node fields become demonstration dataset columns", () => {
    it("keeps the image type on the derived column", () => {
      const fields: Field[] = [
        { identifier: "question", type: "str" },
        { identifier: "photo", type: "image" },
      ];

      expect(fieldsToDatasetColumns(fields)).toEqual([
        { name: "question", type: "string" },
        { name: "photo", type: "image" },
      ]);
    });
  });
});

describe("Studio dataset transforms", () => {
  it("round-trips inline records without editor-only metadata", () => {
    const rows = transposeColumnsFirstToRowsFirstWithId({
      input: ["first", "second"],
      output: ["one", "two"],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ input: "first", output: "one" });
    expect(transpostRowsFirstToColumnsFirstWithoutId(rows)).toEqual({
      input: ["first", "second"],
      output: ["one", "two"],
    });
  });

  it("creates a saved-node reference without copying inline records", () => {
    expect(
      inMemoryDatasetToNodeDataset({
        datasetId: "dataset-1",
        name: "Examples",
        datasetRecords: [],
        columnTypes: [],
      }),
    ).toEqual({ id: "dataset-1", name: "Examples" });
  });

  it("keeps inline records when no saved dataset exists", () => {
    expect(
      inMemoryDatasetToNodeDataset({
        name: "Examples",
        datasetRecords: [{ id: "record-1", input: "hello" }],
        columnTypes: [{ name: "input", type: "string" }],
      }),
    ).toEqual({
      name: "Examples",
      inline: {
        records: { input: ["hello"] },
        columnTypes: [{ name: "input", type: "string" }],
      },
    });
  });

  it("maps dataset columns back to Workflow fields", () => {
    expect(
      datasetColumnsToFields([
        { name: "ready", type: "boolean" },
        { name: "image", type: "image" },
      ]),
    ).toEqual([
      { identifier: "ready", type: "bool" },
      { identifier: "image", type: "image" },
    ]);
  });

  it("serializes stored object values for the in-memory editor", () => {
    expect(
      datasetDatabaseRecordsToInMemoryDataset({
        id: "dataset-1",
        name: "Examples",
        columnTypes: [{ name: "metadata", type: "json" }],
        datasetRecords: [{ id: "record-1", entry: { metadata: { source: "test" } } }],
      }),
    ).toEqual({
      name: "Examples",
      columnTypes: [{ name: "metadata", type: "json" }],
      datasetRecords: [{ id: "record-1", metadata: '{"source":"test"}' }],
    });
  });

  it("rejects malformed stored datasets before building editor records", () => {
    expect(() =>
      datasetDatabaseRecordsToInMemoryDataset({
        id: "dataset-1",
        name: "Examples",
        columnTypes: [{ name: "metadata", type: "not-a-dataset-column" }],
        datasetRecords: [{ id: "record-1", entry: { metadata: "test" } }],
      }),
    ).toThrow();
  });

  it("uses percentage split sizes for both train and test partitions", () => {
    expect(trainTestSplit([1, 2, 3, 4, 5], { trainSize: 0.6, testSize: 0.4 })).toEqual({
      train: [1, 2, 3],
      test: [4, 5],
    });
  });

  it("preserves values as columns are renamed by position", () => {
    expect(
      tryToMapPreviousColumnsToNewColumns(
        [{ id: "record-1", old: "value", stable: "kept" }],
        [
          { name: "old", type: "string" },
          { name: "stable", type: "string" },
        ],
        [
          { name: "renamed", type: "string" },
          { name: "stable", type: "string" },
        ],
      ),
    ).toEqual([{ id: "record-1", renamed: "value", stable: "kept" }]);
  });
});
