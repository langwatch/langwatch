/**
 * @vitest-environment jsdom
 *
 * Store-level unit tests for the entry-point dataset semantics: a
 * dataset attach MERGES its columns into the entry's fields instead of
 * overwriting them (user-defined inputs survive), and legacy "Entry"
 * names normalize to "Entry point" on workflow load.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createStore, type StoreApi } from "zustand";
import type { Entry, Field } from "../../types/dsl";
import {
  store as storeCreator,
  type WorkflowStore,
} from "../workflowStoreCore";

function makeEntryNode({
  outputs = [],
  dataset,
}: {
  outputs?: Field[];
  dataset?: Entry["dataset"];
}) {
  return {
    id: "entry",
    type: "entry",
    position: { x: 0, y: 0 },
    data: {
      name: "Entry point",
      outputs,
      dataset,
      entry_selection: "first",
      train_size: 0.8,
      test_size: 0.2,
      seed: 42,
    } as Entry,
  };
}

const sampleDataset: Entry["dataset"] = {
  id: "dataset-1",
  name: "test-data",
};

describe("workflowStoreCore - entry dataset attach", () => {
  let store: StoreApi<WorkflowStore>;

  beforeEach(() => {
    store = createStore<WorkflowStore>(storeCreator);
  });

  describe("when attaching a dataset to an entry with user-defined inputs", () => {
    /** @scenario Attaching a dataset merges its columns into the inputs */
    it("merges columns into the fields without dropping user inputs", () => {
      store.setState({
        nodes: [
          makeEntryNode({
            outputs: [{ identifier: "feature_flag", type: "str" }],
          }),
        ],
        edges: [],
      });

      store.getState().attachEntryDataset("entry", sampleDataset, [
        { identifier: "query", type: "str" },
        { identifier: "context", type: "str" },
      ]);

      const entry = store.getState().nodes[0]!.data as Entry;
      expect(entry.outputs?.map((f) => f.identifier)).toEqual([
        "feature_flag",
        "query",
        "context",
      ]);
      expect(entry.dataset).toEqual(sampleDataset);
    });

    it("does not duplicate columns already present as inputs", () => {
      store.setState({
        nodes: [
          makeEntryNode({
            outputs: [
              { identifier: "query", type: "str" },
              { identifier: "feature_flag", type: "str" },
            ],
          }),
        ],
        edges: [],
      });

      store.getState().attachEntryDataset("entry", sampleDataset, [
        { identifier: "query", type: "str" },
        { identifier: "context", type: "str" },
      ]);

      const entry = store.getState().nodes[0]!.data as Entry;
      expect(entry.outputs?.map((f) => f.identifier)).toEqual([
        "query",
        "feature_flag",
        "context",
      ]);
    });

    it("replacing the dataset keeps previously merged and user fields", () => {
      store.setState({
        nodes: [
          makeEntryNode({
            outputs: [{ identifier: "query", type: "str" }],
            dataset: sampleDataset,
          }),
        ],
        edges: [],
      });

      store
        .getState()
        .attachEntryDataset("entry", { id: "dataset-2", name: "other" }, [
          { identifier: "context", type: "str" },
        ]);

      const entry = store.getState().nodes[0]!.data as Entry;
      expect(entry.outputs?.map((f) => f.identifier)).toEqual([
        "query",
        "context",
      ]);
      expect(entry.dataset?.id).toBe("dataset-2");
    });
  });
});

describe("workflowStoreCore - legacy entry name normalization", () => {
  let store: StoreApi<WorkflowStore>;

  beforeEach(() => {
    store = createStore<WorkflowStore>(storeCreator);
  });

  describe("when loading a workflow with a legacy 'Entry' node", () => {
    /** @scenario The workflow entry presents as "Entry point" */
    it("renames it to 'Entry point'", () => {
      store.getState().setWorkflow({
        nodes: [
          {
            ...makeEntryNode({ outputs: [] }),
            data: {
              ...makeEntryNode({ outputs: [] }).data,
              name: "Entry",
            },
          },
        ],
        edges: [],
      });

      expect(store.getState().nodes[0]!.data.name).toBe("Entry point");
    });

    it("leaves custom entry names alone", () => {
      store.getState().setWorkflow({
        nodes: [
          {
            ...makeEntryNode({ outputs: [] }),
            data: {
              ...makeEntryNode({ outputs: [] }).data,
              name: "My custom entry",
            },
          },
        ],
        edges: [],
      });

      expect(store.getState().nodes[0]!.data.name).toBe("My custom entry");
    });
  });
});
