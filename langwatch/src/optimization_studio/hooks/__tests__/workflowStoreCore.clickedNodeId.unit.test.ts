/**
 * @vitest-environment jsdom
 *
 * Store-level unit tests for `clickedNodeId` — the field that gates the
 * StudioNodeDrawer behind a real click (mousedown + mouseup without drag),
 * fixing https://github.com/langwatch/langwatch/issues/2269.
 *
 * These tests pin the store contract that StudioNodeDrawer relies on:
 *   - `clickedNodeId` is set by `setClickedNodeId` / `setSelectedNode`
 *   - `clickedNodeId` is cleared on deselect, drag start, deselectAll,
 *     and when the workflow itself becomes selected.
 *
 * The drawer's render-time predicate is exercised separately by the
 * StudioNodeDrawer component tests; this file does not duplicate it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand";
import {
  store as storeCreator,
  type WorkflowStore,
} from "../workflowStoreCore";

function makeNode({
  id,
  type = "signature",
  selected = false,
}: {
  id: string;
  type?: string;
  selected?: boolean;
}) {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    selected,
    data: {
      inputs: [],
      outputs: [],
      parameters: [],
    },
  };
}

describe("workflowStoreCore — clickedNodeId lifecycle", () => {
  let store: StoreApi<WorkflowStore>;

  beforeEach(() => {
    store = createStore<WorkflowStore>(storeCreator);
    store.setState({
      nodes: [makeNode({ id: "node-1" }), makeNode({ id: "node-2" })],
      edges: [],
    });
  });

  describe("when ReactFlow selects a node via mousedown", () => {
    it("does not set clickedNodeId", () => {
      store.getState().onNodesChange([
        { id: "node-1", type: "select", selected: true },
      ]);

      const state = store.getState();
      expect(state.nodes.find((n) => n.id === "node-1")?.selected).toBe(true);
      expect(state.clickedNodeId).toBeNull();
    });
  });

  describe("when onNodeClick fires after selection", () => {
    it("records clickedNodeId for the selected node", () => {
      store.getState().onNodesChange([
        { id: "node-1", type: "select", selected: true },
      ]);
      store.getState().setClickedNodeId("node-1");

      expect(store.getState().clickedNodeId).toBe("node-1");
    });
  });

  describe("when a node is deselected", () => {
    it("clears clickedNodeId", () => {
      store.getState().onNodesChange([
        { id: "node-1", type: "select", selected: true },
      ]);
      store.getState().setClickedNodeId("node-1");

      store.getState().onNodesChange([
        { id: "node-1", type: "select", selected: false },
      ]);

      expect(store.getState().clickedNodeId).toBeNull();
    });
  });

  describe("when drag starts", () => {
    it("clears clickedNodeId", () => {
      store.getState().setClickedNodeId("node-1");
      store.getState().setIsDraggingNode(true);

      expect(store.getState().clickedNodeId).toBeNull();
    });
  });

  describe("when setSelectedNode is called programmatically", () => {
    it("sets clickedNodeId so the drawer can open", () => {
      store.getState().setSelectedNode("node-1");

      expect(store.getState().clickedNodeId).toBe("node-1");
    });
  });

  describe("when deselectAllNodes is called", () => {
    it("clears clickedNodeId", () => {
      store.getState().setSelectedNode("node-1");
      store.getState().deselectAllNodes();

      expect(store.getState().clickedNodeId).toBeNull();
    });
  });

  describe("when the workflow itself becomes selected", () => {
    it("clears clickedNodeId so the drawer cannot reopen on the next mousedown", () => {
      store.getState().setSelectedNode("node-1");
      expect(store.getState().clickedNodeId).toBe("node-1");

      store.getState().setWorkflowSelected(true);

      expect(store.getState().clickedNodeId).toBeNull();
    });
  });
});
