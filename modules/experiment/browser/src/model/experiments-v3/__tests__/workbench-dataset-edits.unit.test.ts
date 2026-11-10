/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import type { DatasetColumn, DatasetReference } from "../types.ts";
import { datasetEditDraft, editedDatasetUpdate } from "../workbench-dataset-edits.ts";

const inlineDataset = (): DatasetReference => {
  const columns: DatasetColumn[] = [
    { id: "input_0", name: "input", type: "string" },
    { id: "test_1", name: "test", type: "string" },
  ];
  return {
    id: "dataset-1",
    name: "Draft",
    type: "inline",
    columns,
    inline: {
      columns,
      records: { input_0: ["question one", "question two"], test_1: ["hello", "world"] },
    },
  };
};

/** The drawer's answer: the draft's columns, edited by `edit`, with their ids kept. */
const editInDrawer = ({
  dataset,
  edit,
}: {
  dataset: DatasetReference;
  edit: (
    columns: { id?: string; name: string; type: string }[],
  ) => { id?: string; name: string; type: string }[];
}) => {
  const draft = datasetEditDraft(dataset);
  return editedDatasetUpdate({
    dataset,
    edited: { datasetId: "", name: draft.name, columnTypes: edit(draft.columnTypes) },
    rowCount: 2,
  });
};

/** Each column's values by name, as the edited dataset holds them. */
const valuesByName = (update: Partial<DatasetReference>) =>
  Object.fromEntries(
    (update.columns ?? []).map((column) => [column.name, update.inline?.records[column.id]]),
  );

describe("editedDatasetUpdate()", () => {
  describe("given an inline dataset with values", () => {
    /** @scenario "Renaming an inline dataset column keeps its values" */
    it("keeps a renamed column's values", () => {
      const update = editInDrawer({
        dataset: inlineDataset(),
        edit: (columns) => columns.map((c) => (c.name === "test" ? { ...c, name: "test2" } : c)),
      });

      expect(valuesByName(update)).toEqual({
        input: ["question one", "question two"],
        test2: ["hello", "world"],
      });
    });

    /** @scenario "Renaming an inline dataset column keeps its values" */
    it("starts an added column empty", () => {
      const update = editInDrawer({
        dataset: inlineDataset(),
        edit: (columns) => [...columns, { name: "extra", type: "string" }],
      });

      expect(valuesByName(update)).toEqual({
        input: ["question one", "question two"],
        test: ["hello", "world"],
        extra: ["", ""],
      });
    });

    /** @scenario "Renaming an inline dataset column keeps its values" */
    it("drops a deleted column and keeps the rest, even when another is renamed", () => {
      const update = editInDrawer({
        dataset: inlineDataset(),
        edit: (columns) =>
          columns.filter((c) => c.name !== "input").map((c) => ({ ...c, name: "renamed" })),
      });

      expect(valuesByName(update)).toEqual({ renamed: ["hello", "world"] });
      expect(Object.keys(update.inline?.records ?? {})).toEqual(update.columns?.map((c) => c.id));
    });

    /** @scenario "Renaming an inline dataset column keeps its values" */
    it("keeps values with their column when the columns are reordered", () => {
      const update = editInDrawer({
        dataset: inlineDataset(),
        edit: (columns) => [...columns].reverse(),
      });

      expect(update.columns?.map((c) => c.name)).toEqual(["test", "input"]);
      expect(valuesByName(update)).toEqual({
        test: ["hello", "world"],
        input: ["question one", "question two"],
      });
    });

    /** @scenario "Renaming an inline dataset column keeps its values" */
    it("starts a new column empty even when it reuses a deleted column's name", () => {
      const update = editInDrawer({
        dataset: inlineDataset(),
        edit: (columns) => [
          ...columns.filter((c) => c.name !== "test"),
          { name: "test", type: "string" },
        ],
      });

      expect(valuesByName(update)).toEqual({
        input: ["question one", "question two"],
        test: ["", ""],
      });
    });
  });

  describe("given a saved dataset with its records loaded", () => {
    const savedDataset = (): DatasetReference => ({
      id: "saved_ds-1",
      name: "Saved",
      type: "saved",
      datasetId: "ds-1",
      columns: [
        { id: "input_0", name: "input", type: "string" },
        { id: "test_1", name: "test", type: "string" },
      ],
      savedRecords: [
        { id: "rec-1", input: "question one", test: "hello" },
        { id: "rec-2", input: "question two", test: "world" },
      ],
    });

    /** @scenario "Renaming a saved dataset column keeps its values in the workbench" */
    it("re-keys the cached records to the renamed column", () => {
      const dataset = savedDataset();
      const draft = datasetEditDraft(dataset);
      const update = editedDatasetUpdate({
        dataset,
        edited: {
          datasetId: "ds-1",
          name: draft.name,
          columnTypes: draft.columnTypes.map((c) =>
            c.name === "test" ? { ...c, name: "test2" } : c,
          ),
        },
        rowCount: 2,
      });

      expect(update.columns?.map((c) => c.name)).toEqual(["input", "test2"]);
      expect(update.savedRecords).toEqual([
        { id: "rec-1", input: "question one", test2: "hello" },
        { id: "rec-2", input: "question two", test2: "world" },
      ]);
    });
  });
});
