/**
 * A transformed state reaches the store through the store's own actions, so
 * what the store derives (the parsed query, the cursors, the lens's own view)
 * follows.
 *
 * Spec: specs/traces-v2/explorer-actions.feature ("A transformed state is
 * committed through the store's own actions").
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerStore } from "../../stores/explorerStore";
import { commitExplorerState, readExplorerState } from "../commitExplorerState";
import { setFilter } from "../transforms/query";
import { select } from "../transforms/rows";
import { setLens } from "../transforms/view";

beforeEach(() => {
  const store = useExplorerStore.getState();
  store.selectLens("all-traces", { persist: false });
  store.clearAll();
  store.clearSelection();
  store.setExpandedRows([]);
});

describe("commitExplorerState", () => {
  describe("given the store is on page 2 with keyset cursors", () => {
    /** @scenario "A committed filter is parsed and returns the list to its first page" */
    it("holds the parsed query, page 1 and no cursors", () => {
      const store = useExplorerStore.getState();
      store.setPageCursor({ page: 2, cursor: "cursor-2" });
      store.setPage(2);

      const { state } = setFilter({
        state: readExplorerState(),
        payload: { query: "status:error" },
      });
      commitExplorerState(state);

      const after = useExplorerStore.getState();
      expect(after.queryText).toBe("status:error");
      expect(after.ast.type).not.toBe("EmptyExpression");
      expect(after.page).toBe(1);
      expect(after.pageCursors).toEqual({ 1: null });
    });
  });

  describe("given a transformed state naming another lens", () => {
    /** @scenario "A committed lens installs the lens through the lens action" */
    it("makes the store's lens, sort and grouping that lens's", () => {
      const lenses = useExplorerStore.getState().allLenses;
      const conversations = lenses.find((l) => l.id === "conversations");
      expect(conversations).toBeDefined();

      const { state } = setLens({
        state: readExplorerState(),
        payload: { lensId: "conversations" },
        context: { lenses },
      });
      commitExplorerState(state);

      const after = useExplorerStore.getState();
      expect(after.activeLensId).toBe("conversations");
      expect(after.grouping).toBe(conversations?.grouping);
      expect(after.sort).toEqual(conversations?.sort);
    });
  });

  describe("given a transformed selection", () => {
    it("replaces the store's selection", () => {
      const { state } = select({
        state: readExplorerState(),
        payload: { traceIds: ["trace-a", "trace-b"] },
      });
      commitExplorerState(state);
      expect(
        Array.from(useExplorerStore.getState().selection.traceIds),
      ).toEqual(["trace-a", "trace-b"]);
    });
  });

  describe("given a state equal to the store's", () => {
    it("writes nothing", () => {
      const before = useExplorerStore.getState();
      commitExplorerState(readExplorerState());
      expect(useExplorerStore.getState()).toBe(before);
    });
  });
});
