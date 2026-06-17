/**
 * @vitest-environment jsdom
 *
 * Store-level tests for if/else branch-to-gate connections: dropping a branch
 * on a node's temporary gate materializes a real bool "gate" input wired to
 * the branch, and the branch-drag flag (plus its source id) drives the
 * temporary gate rows the nodes render.
 */
import type { Node } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createStore, type StoreApi } from "zustand";

import { GATE_FIELD, GATE_HANDLE_ID } from "../../utils/controlFlow";
import {
  store as storeCreator,
  type WorkflowStore,
} from "../workflowStoreCore";

const node = (
  id: string,
  type: string,
  inputs: { identifier: string; type: string }[] = [],
): Node =>
  ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: { name: id, inputs },
  }) as unknown as Node;

const baseNodes = [
  node("entry", "entry"),
  node("gate", "if_else"),
  node("codeA", "code"),
] as unknown as Node[];

describe("workflowStoreCore - branch gate connections", () => {
  let store: StoreApi<WorkflowStore>;

  beforeEach(() => {
    store = createStore<WorkflowStore>(storeCreator);
    store.setState({ nodes: baseNodes, edges: [] });
  });

  describe("when a branch is dropped on a node's temporary gate", () => {
    /** @scenario Connecting a branch to the temporary gate adds a real gate input */
    it("materializes a real bool gate input wired to the branch", () => {
      const result = store.getState().onConnect({
        source: "gate",
        sourceHandle: "outputs.true",
        target: "codeA",
        targetHandle: GATE_HANDLE_ID,
      });

      expect(result).toBeUndefined();
      const target = store.getState().nodes.find((n) => n.id === "codeA");
      expect((target?.data as { inputs?: unknown[] }).inputs).toEqual([
        { identifier: GATE_FIELD, type: "bool" },
      ]);
      const edges = store.getState().edges;
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: "gate",
        sourceHandle: "outputs.true",
        target: "codeA",
        targetHandle: GATE_HANDLE_ID,
        type: "default",
      });
    });

    it("does not add a second gate when the node already has one", () => {
      store.setState({
        nodes: [
          node("entry", "entry"),
          node("gate", "if_else"),
          node("codeA", "code", [{ identifier: "gate", type: "bool" }]),
        ] as unknown as Node[],
        edges: [],
      });

      store.getState().onConnect({
        source: "gate",
        sourceHandle: "outputs.true",
        target: "codeA",
        targetHandle: GATE_HANDLE_ID,
      });

      const target = store.getState().nodes.find((n) => n.id === "codeA");
      expect((target?.data as { inputs?: unknown[] }).inputs).toEqual([
        { identifier: "gate", type: "bool" },
      ]);
      expect(store.getState().edges).toHaveLength(1);
    });

    it("appends the gate after the node's existing inputs", () => {
      store.setState({
        nodes: [
          node("entry", "entry"),
          node("gate", "if_else"),
          node("codeA", "code", [{ identifier: "question", type: "str" }]),
        ] as unknown as Node[],
        edges: [],
      });

      store.getState().onConnect({
        source: "gate",
        sourceHandle: "outputs.false",
        target: "codeA",
        targetHandle: GATE_HANDLE_ID,
      });

      const target = store.getState().nodes.find((n) => n.id === "codeA");
      expect((target?.data as { inputs?: unknown[] }).inputs).toEqual([
        { identifier: "question", type: "str" },
        { identifier: GATE_FIELD, type: "bool" },
      ]);
    });
  });

  describe("when a connection drag starts", () => {
    /** @scenario Every node grows a temporary gate input while dragging a branch */
    it("flags a branch drag and records its source so nodes show the temporary gate", () => {
      store
        .getState()
        .onConnectStart({ nodeId: "gate", handleId: "outputs.true" });
      expect(store.getState().branchConnectionInProgress).toBe(true);
      expect(store.getState().branchConnectionSourceId).toBe("gate");

      store.getState().onConnectEnd();
      expect(store.getState().branchConnectionInProgress).toBe(false);
      expect(store.getState().branchConnectionSourceId).toBe(null);
    });

    it("does not flag a drag from an ordinary output handle", () => {
      store
        .getState()
        .onConnectStart({ nodeId: "codeA", handleId: "outputs.answer" });
      expect(store.getState().branchConnectionInProgress).toBe(false);
      expect(store.getState().branchConnectionSourceId).toBe(null);
    });
  });
});
