/**
 * @vitest-environment jsdom
 *
 * Regression test for https://github.com/langwatch/langwatch/issues/2269
 *
 * Bug: ReactFlow selects nodes on mousedown, which triggers the drawer to open.
 * Dragging a node also opens the drawer because isDraggingNode is set too late.
 *
 * Fix: Gate drawer opening on `clickedNodeId` — a field that is only set by
 * `onNodeClick` (which fires on genuine click = mousedown + mouseup without drag).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand";
import {
  store as storeCreator,
  type WorkflowStore,
} from "../../../hooks/workflowStoreCore";

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

/**
 * Computes the effectiveNode the same way StudioNodeDrawer does:
 * the selected node is only "effective" (drawer opens) when
 * clickedNodeId matches the selected node's id.
 */
function getEffectiveNode(state: WorkflowStore) {
  const selectedNode = state.nodes.find((n) => n.selected);
  const hasClickConfirmation =
    selectedNode && state.clickedNodeId === selectedNode.id;
  return hasClickConfirmation && !state.isDraggingNode
    ? selectedNode
    : undefined;
}

describe("StudioNodeDrawer — click vs drag gating", () => {
  let store: StoreApi<WorkflowStore>;

  beforeEach(() => {
    store = createStore<WorkflowStore>(storeCreator);
    store.setState({
      nodes: [makeNode({ id: "node-1" }), makeNode({ id: "node-2" })],
      edges: [],
    });
  });

  describe("when a node is selected via mousedown but not clicked", () => {
    it("does not produce an effective node (drawer stays closed)", () => {
      // Simulate ReactFlow selecting the node on mousedown (before any click fires)
      store.getState().onNodesChange([
        { id: "node-1", type: "select", selected: true },
      ]);

      const state = store.getState();
      expect(state.nodes.find((n) => n.id === "node-1")?.selected).toBe(true);
      // clickedNodeId was never set — drawer must not open
      expect(state.clickedNodeId).toBeNull();
      expect(getEffectiveNode(state)).toBeUndefined();
    });
  });

  describe("when a node is selected AND onNodeClick fires", () => {
    it("produces an effective node (drawer opens)", () => {
      // 1. ReactFlow selects the node on mousedown
      store.getState().onNodesChange([
        { id: "node-1", type: "select", selected: true },
      ]);
      // 2. User releases mouse without dragging — onNodeClick fires
      store.getState().setClickedNodeId("node-1");

      const state = store.getState();
      expect(getEffectiveNode(state)).toBeDefined();
      expect(getEffectiveNode(state)?.id).toBe("node-1");
    });
  });

  describe("when a node is being dragged", () => {
    it("does not produce an effective node even if clickedNodeId is set", () => {
      store.getState().onNodesChange([
        { id: "node-1", type: "select", selected: true },
      ]);
      store.getState().setClickedNodeId("node-1");
      store.getState().setIsDraggingNode(true);

      expect(getEffectiveNode(store.getState())).toBeUndefined();
    });
  });

  describe("when a node is deselected", () => {
    it("clears clickedNodeId", () => {
      // Select and click a node
      store.getState().onNodesChange([
        { id: "node-1", type: "select", selected: true },
      ]);
      store.getState().setClickedNodeId("node-1");
      expect(store.getState().clickedNodeId).toBe("node-1");

      // Deselect the node
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
    it("sets clickedNodeId so the drawer opens", () => {
      store.getState().setSelectedNode("node-1");

      const state = store.getState();
      expect(state.clickedNodeId).toBe("node-1");
      expect(getEffectiveNode(state)).toBeDefined();
      expect(getEffectiveNode(state)?.id).toBe("node-1");
    });
  });

  describe("when deselectAllNodes is called", () => {
    it("clears clickedNodeId", () => {
      store.getState().setSelectedNode("node-1");
      expect(store.getState().clickedNodeId).toBe("node-1");

      store.getState().deselectAllNodes();
      expect(store.getState().clickedNodeId).toBeNull();
    });
  });
});
