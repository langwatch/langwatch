/**
 * What each built-in lens puts in front of the reader when it is selected.
 * @see specs/traces-v2/trace-table.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useExplorerStore } from "../explorer.store.ts";

function selectBuiltIn(id: string) {
  const store = useExplorerStore.getState();
  store.selectLens(id, { persist: false });
  return useExplorerStore.getState();
}

beforeEach(() => {
  const store = useExplorerStore.getState();
  store.selectLens("all-traces", { persist: false });
  store.clearAll();
});

describe("the All Traces lens", () => {
  describe("given a reader with no saved lens", () => {
    /** @scenario All Traces is the default lens */
    it("opens on All with the traces in a flat list", () => {
      const state = selectBuiltIn("all-traces");

      expect(state.activeLensId).toBe("all-traces");
      expect(state.allLenses.find((lens) => lens.id === "all-traces")?.name).toBe("All");
      expect(state.grouping).toBe("flat");
    });

    /** @scenario Default sort is by time descending */
    it("sorts by time, newest first", () => {
      expect(selectBuiltIn("all-traces").sort).toEqual({ columnId: "time", direction: "desc" });
    });

    /** @scenario No filters are locked */
    it("injects no query of its own, so no filter section is held by the lens", () => {
      const state = selectBuiltIn("all-traces");

      expect(state.allLenses.find((lens) => lens.id === "all-traces")?.filterText).toBe("");
      expect(state.queryText).toBe("");
    });
  });
});

describe("the Conversations lens", () => {
  describe("when the reader selects it", () => {
    /** @scenario Switching to Conversations groups traces by conversation ID */
    it("groups the rows by conversation", () => {
      expect(selectBuiltIn("conversations").grouping).toBe("by-conversation");
    });
  });
});

describe("the Errors lens", () => {
  describe("when the reader selects it", () => {
    /** @scenario Switching to Errors shows only error traces */
    it("injects status:error into the query text", () => {
      const state = selectBuiltIn("errors");

      expect(state.queryText).toBe("status:error");
      expect(state.grouping).toBe("flat");
    });

    /** @scenario Errors sorted by timestamp descending */
    it("sorts the error traces by time, newest first", () => {
      expect(selectBuiltIn("errors").sort).toEqual({ columnId: "time", direction: "desc" });
    });
  });
});
