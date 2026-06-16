import { describe, expect, it } from "vitest";

import {
  createDatasetEditorStore,
  type EditorColumn,
} from "../useDatasetEditorStore";

const columns: EditorColumn[] = [
  { id: "input_0", name: "input", type: "string" },
];

const seedSaved = () => {
  const store = createDatasetEditorStore();
  store.getState().setData({
    columns,
    records: [
      { id: "srv-1", input: "server row" },
      { id: "new_123", input: "row persisted under a client-generated id" },
    ],
    dbDatasetId: "ds-1",
  });
  return store;
};

describe("deleteSelectedRows (saved mode)", () => {
  describe("when deleting a server-backed record", () => {
    it("queues a server deletion and drops the row locally", () => {
      const store = seedSaved();
      store.getState().toggleRowSelection(0);
      store.getState().deleteSelectedRows();

      expect(store.getState().pendingSavedChanges["ds-1"]?.["srv-1"]).toEqual({
        _delete: true,
      });
      expect(store.getState().records.map((r) => r.id)).toEqual(["new_123"]);
    });
  });

  describe("when deleting a row that persisted under a client-generated new_ id", () => {
    // Regression: the backend creates locally-added rows under their "new_"
    // id, so deleting one must still send a server deletion. Treating any
    // "new_" id as local-only left the row in the database and it reappeared
    // on reload.
    /** @scenario Deleting a row that was added and saved in the editor persists */
    it("queues a server deletion, not a silent local-only drop", () => {
      const store = seedSaved();
      store.getState().toggleRowSelection(1);
      store.getState().deleteSelectedRows();

      expect(
        store.getState().pendingSavedChanges["ds-1"]?.["new_123"],
      ).toEqual({ _delete: true });
      expect(store.getState().records).toHaveLength(1);
    });
  });

  describe("when deleting a new_ row that still has an unsaved edit queued", () => {
    it("replaces the queued edit with a deletion", () => {
      const store = seedSaved();
      store.getState().setCellValue("ds-1", 1, "input_0", "edited");
      store.getState().toggleRowSelection(1);
      store.getState().deleteSelectedRows();

      expect(
        store.getState().pendingSavedChanges["ds-1"]?.["new_123"],
      ).toEqual({ _delete: true });
    });
  });
});

describe("deleteSelectedRows (in-memory / draft mode)", () => {
  describe("when deleting a row", () => {
    it("removes it locally without queuing any server change", () => {
      const store = createDatasetEditorStore();
      store.getState().setData({
        columns,
        records: [
          { id: "new_1", input: "a" },
          { id: "new_2", input: "b" },
        ],
        dbDatasetId: undefined,
      });
      store.getState().toggleRowSelection(0);
      store.getState().deleteSelectedRows();

      expect(store.getState().records.map((r) => r.id)).toEqual(["new_2"]);
      expect(store.getState().pendingSavedChanges).toEqual({});
    });
  });
});
