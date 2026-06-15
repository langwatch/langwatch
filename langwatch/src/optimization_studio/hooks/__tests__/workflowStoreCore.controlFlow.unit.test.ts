/**
 * @vitest-environment jsdom
 *
 * Store-level tests for control-flow connections: dragging an If/Else
 * branch onto a node's control handle creates a control-flow edge (gates
 * execution, carries no value), and the branch-drag flag drives the green
 * control-flow targets.
 */
import type { Node } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createStore, type StoreApi } from "zustand";

import {
  CONTROL_FLOW_EDGE_TYPE,
  CONTROL_FLOW_HANDLE_ID,
} from "../../utils/controlFlow";
import {
  store as storeCreator,
  type WorkflowStore,
} from "../workflowStoreCore";

const node = (id: string, type: string): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { name: id },
});

const baseNodes = [
  node("entry", "entry"),
  node("gate", "if_else"),
  node("codeA", "code"),
] as unknown as Node[];

describe("workflowStoreCore - control-flow connections", () => {
  let store: StoreApi<WorkflowStore>;

  beforeEach(() => {
    store = createStore<WorkflowStore>(storeCreator);
    store.setState({ nodes: baseNodes, edges: [] });
  });

  describe("when a branch is dropped on a node's control handle", () => {
    /** @scenario Connecting a branch to a node gates it without adding an input */
    it("creates a control-flow edge to the node, not an input", () => {
      const result = store.getState().onConnect({
        source: "gate",
        sourceHandle: "outputs.true",
        target: "codeA",
        targetHandle: CONTROL_FLOW_HANDLE_ID,
      });

      expect(result).toBeUndefined();
      const edges = store.getState().edges;
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: "gate",
        sourceHandle: "outputs.true",
        target: "codeA",
        targetHandle: CONTROL_FLOW_HANDLE_ID,
        type: CONTROL_FLOW_EDGE_TYPE,
      });
    });

    it("does not add a gate input to the target node", () => {
      store.getState().onConnect({
        source: "gate",
        sourceHandle: "outputs.true",
        target: "codeA",
        targetHandle: CONTROL_FLOW_HANDLE_ID,
      });

      const target = store.getState().nodes.find((n) => n.id === "codeA");
      const inputs = (target?.data as { inputs?: unknown[] }).inputs ?? [];
      expect(inputs).toHaveLength(0);
    });

    it("allows a second branch onto the same control handle without a convergence error", () => {
      store.getState().onConnect({
        source: "gate",
        sourceHandle: "outputs.true",
        target: "codeA",
        targetHandle: CONTROL_FLOW_HANDLE_ID,
      });
      const result = store.getState().onConnect({
        source: "gate",
        sourceHandle: "outputs.false",
        target: "codeA",
        targetHandle: CONTROL_FLOW_HANDLE_ID,
      });

      expect(result).toBeUndefined();
      expect(store.getState().edges).toHaveLength(2);
    });
  });

  describe("when a connection drag starts", () => {
    /** @scenario Every node exposes a control-flow connection point while dragging a branch */
    it("flags a branch drag from an if/else branch handle", () => {
      store
        .getState()
        .onConnectStart({ nodeId: "gate", handleId: "outputs.true" });
      expect(store.getState().branchConnectionInProgress).toBe(true);

      store.getState().onConnectEnd();
      expect(store.getState().branchConnectionInProgress).toBe(false);
    });

    it("does not flag a drag from an ordinary output handle", () => {
      store
        .getState()
        .onConnectStart({ nodeId: "codeA", handleId: "outputs.answer" });
      expect(store.getState().branchConnectionInProgress).toBe(false);
    });
  });
});
