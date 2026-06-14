/**
 * @vitest-environment jsdom
 *
 * Store-level tests for branch convergence in onConnect: two mutually
 * exclusive If/Else branches may feed the same input, while two sources
 * that can run at the same time are rejected.
 */
import type { Edge, Node } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createStore, type StoreApi } from "zustand";

import { store as storeCreator, type WorkflowStore } from "../workflowStoreCore";

const node = (id: string, type: string): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { name: id },
});

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): Edge => ({
  id,
  source,
  target,
  sourceHandle: `outputs.${sourceHandle}`,
  targetHandle: `inputs.${targetHandle}`,
  type: "default",
});

// entry ──► gate ──true──► codeA
//             └───false──► codeB     both branches aim at end.answer
const forkNodes = [
  node("entry", "entry"),
  node("gate", "if_else"),
  node("codeA", "code"),
  node("codeB", "code"),
  node("end", "end"),
];
const forkEdges = [
  edge("e1", "entry", "q", "gate", "context"),
  edge("e2", "gate", "true", "codeA", "gate"),
  edge("e3", "gate", "false", "codeB", "gate"),
];

const edgesIntoAnswer = (edges: Edge[]) =>
  edges.filter(
    (e) => e.target === "end" && e.targetHandle === "inputs.answer",
  );

describe("workflowStoreCore - branch convergence on connect", () => {
  let store: StoreApi<WorkflowStore>;

  beforeEach(() => {
    store = createStore<WorkflowStore>(storeCreator);
  });

  describe("when both branches of one gate feed the same input", () => {
    /** @scenario Mutually exclusive branch outputs can converge on one input */
    it("accepts the second, converging connection", () => {
      store.setState({
        nodes: forkNodes as unknown as Node[],
        edges: [...forkEdges, edge("c1", "codeA", "out", "end", "answer")],
      });

      const result = store.getState().onConnect({
        source: "codeB",
        sourceHandle: "outputs.out",
        target: "end",
        targetHandle: "inputs.answer",
      });

      expect(result).toBeUndefined();
      expect(edgesIntoAnswer(store.getState().edges)).toHaveLength(2);
    });
  });

  describe("when two nodes that both always run feed the same input", () => {
    /** @scenario Concurrent outputs cannot converge on one input */
    it("rejects the second connection with a clear message", () => {
      store.setState({
        nodes: [
          node("entry", "entry"),
          node("x", "code"),
          node("y", "code"),
          node("end", "end"),
        ] as unknown as Node[],
        edges: [
          edge("e1", "entry", "q", "x", "in"),
          edge("e2", "entry", "q", "y", "in"),
          edge("c1", "x", "out", "end", "answer"),
        ],
      });

      const result = store.getState().onConnect({
        source: "y",
        sourceHandle: "outputs.out",
        target: "end",
        targetHandle: "inputs.answer",
      });

      expect(result?.error).toContain("mutually exclusive");
      expect(edgesIntoAnswer(store.getState().edges)).toHaveLength(1);
    });
  });

  describe("when the input has no source yet", () => {
    it("accepts the first connection unchanged", () => {
      store.setState({
        nodes: forkNodes as unknown as Node[],
        edges: forkEdges,
      });

      const result = store.getState().onConnect({
        source: "codeA",
        sourceHandle: "outputs.out",
        target: "end",
        targetHandle: "inputs.answer",
      });

      expect(result).toBeUndefined();
      expect(edgesIntoAnswer(store.getState().edges)).toHaveLength(1);
    });
  });
});
