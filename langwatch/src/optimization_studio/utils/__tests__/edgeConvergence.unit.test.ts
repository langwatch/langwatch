import type { Connection, Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  canConvergeOnInput,
  computeNodeGuards,
  guardsAreMutuallyExclusive,
} from "../edgeConvergence";

const node = (id: string, type: string): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {},
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

const connection = (
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): Connection => ({
  source,
  target,
  sourceHandle: `outputs.${sourceHandle}`,
  targetHandle: `inputs.${targetHandle}`,
});

// entry ──► gate ──true──► codeA ──► end.answer
//             └───false──► codeB ──► end.answer  (the convergence)
const forkNodes: Node[] = [
  node("entry", "entry"),
  node("gate", "if_else"),
  node("codeA", "code"),
  node("codeB", "code"),
  node("end", "end"),
];
const forkEdges: Edge[] = [
  edge("e1", "entry", "q", "gate", "context"),
  edge("e2", "gate", "true", "codeA", "gate"),
  edge("e3", "gate", "false", "codeB", "gate"),
];

describe("computeNodeGuards", () => {
  describe("given a single if/else fork", () => {
    it("gives the entry and gate no guards", () => {
      const guards = computeNodeGuards({ nodes: forkNodes, edges: forkEdges });
      expect([...(guards.get("entry") ?? [])]).toEqual([]);
      expect([...(guards.get("gate") ?? [])]).toEqual([]);
    });

    it("guards a true-branch node by the gate's true side", () => {
      const guards = computeNodeGuards({ nodes: forkNodes, edges: forkEdges });
      expect([...(guards.get("codeA") ?? [])]).toEqual(["gate:true"]);
    });

    it("guards a false-branch node by the gate's false side", () => {
      const guards = computeNodeGuards({ nodes: forkNodes, edges: forkEdges });
      expect([...(guards.get("codeB") ?? [])]).toEqual(["gate:false"]);
    });
  });

  describe("given a node fed by two data sources on opposite branches", () => {
    it("keeps only the guards common to all data sources", () => {
      // a merge node fed by codeA (gate:true) and codeB (gate:false) has no
      // common guard, so it is effectively always reachable.
      const nodes = [...forkNodes, node("merge", "code")];
      const edges = [
        ...forkEdges,
        edge("m1", "codeA", "out", "merge", "x"),
        edge("m2", "codeB", "out", "merge", "x"),
      ];
      const guards = computeNodeGuards({ nodes, edges });
      expect([...(guards.get("merge") ?? [])]).toEqual([]);
    });
  });

  describe("given a node wired to BOTH handles of one gate", () => {
    it("requires the gate to be alive but no particular side", () => {
      const nodes = [...forkNodes, node("either", "code")];
      const edges = [
        ...forkEdges,
        edge("b1", "gate", "true", "either", "x"),
        edge("b2", "gate", "false", "either", "x"),
      ];
      const guards = computeNodeGuards({ nodes, edges });
      // gate itself has no guards, and neither side is required -> empty.
      expect([...(guards.get("either") ?? [])]).toEqual([]);
    });
  });

  describe("given a nested fork", () => {
    it("accumulates a guard per gate down the path", () => {
      const nodes = [
        node("entry", "entry"),
        node("outer", "if_else"),
        node("inner", "if_else"),
        node("leaf", "code"),
      ];
      const edges = [
        edge("e1", "entry", "q", "outer", "c"),
        edge("e2", "outer", "true", "inner", "c"),
        edge("e3", "inner", "true", "leaf", "g"),
      ];
      const guards = computeNodeGuards({ nodes, edges });
      expect(guards.get("inner")).toEqual(new Set(["outer:true"]));
      expect(guards.get("leaf")).toEqual(
        new Set(["outer:true", "inner:true"]),
      );
    });
  });
});

describe("guardsAreMutuallyExclusive", () => {
  describe("when two guard sets disagree on a gate side", () => {
    it("reports them as mutually exclusive", () => {
      expect(
        guardsAreMutuallyExclusive(
          new Set(["gate:true"]),
          new Set(["gate:false"]),
        ),
      ).toBe(true);
    });

    it("detects the conflict on a shared nested gate", () => {
      expect(
        guardsAreMutuallyExclusive(
          new Set(["outer:true", "inner:true"]),
          new Set(["outer:true", "inner:false"]),
        ),
      ).toBe(true);
    });
  });

  describe("when the guard sets can both hold", () => {
    it("treats identical guards as not exclusive", () => {
      expect(
        guardsAreMutuallyExclusive(
          new Set(["gate:true"]),
          new Set(["gate:true"]),
        ),
      ).toBe(false);
    });

    it("treats two always-reachable nodes as not exclusive", () => {
      expect(guardsAreMutuallyExclusive(new Set(), new Set())).toBe(false);
    });

    it("treats a guarded node and an always-reachable node as not exclusive", () => {
      expect(
        guardsAreMutuallyExclusive(new Set(["gate:true"]), new Set()),
      ).toBe(false);
    });
  });
});

describe("canConvergeOnInput", () => {
  describe("when the input has no source yet", () => {
    it("allows the first connection", () => {
      expect(
        canConvergeOnInput({
          nodes: forkNodes,
          edges: forkEdges,
          connection: connection("codeA", "out", "end", "answer"),
        }),
      ).toBe(true);
    });
  });

  describe("when the existing source is on the opposite branch", () => {
    it("allows two mutually exclusive branches to converge", () => {
      const edges = [
        ...forkEdges,
        edge("conv", "codeA", "out", "end", "answer"),
      ];
      expect(
        canConvergeOnInput({
          nodes: forkNodes,
          edges,
          connection: connection("codeB", "out", "end", "answer"),
        }),
      ).toBe(true);
    });
  });

  describe("when both sources always run", () => {
    it("rejects two concurrent nodes on the same input", () => {
      const nodes = [
        node("entry", "entry"),
        node("x", "code"),
        node("y", "code"),
        node("end", "end"),
      ];
      const edges = [
        edge("e1", "entry", "q", "x", "in"),
        edge("e2", "entry", "q", "y", "in"),
        edge("conv", "x", "out", "end", "answer"),
      ];
      expect(
        canConvergeOnInput({
          nodes,
          edges,
          connection: connection("y", "out", "end", "answer"),
        }),
      ).toBe(false);
    });
  });

  describe("when both edges come from the same node", () => {
    /** @scenario Two outputs of the same node cannot converge on one input */
    it("rejects two outputs of one node on the same input", () => {
      const edges = [
        ...forkEdges,
        edge("conv", "codeA", "out1", "end", "answer"),
      ];
      expect(
        canConvergeOnInput({
          nodes: forkNodes,
          edges,
          connection: connection("codeA", "out2", "end", "answer"),
        }),
      ).toBe(false);
    });
  });

  describe("when leaves of a nested fork converge", () => {
    /** @scenario A nested fork still converges on a shared input */
    it("allows every mutually exclusive leaf onto one input", () => {
      // outer fork; inner fork on the outer.true branch. Three leaves:
      // outerFalse (outer:false), innerTrue (outer:true,inner:true),
      // innerFalse (outer:true,inner:false) - all pairwise exclusive.
      const nodes = [
        node("entry", "entry"),
        node("outer", "if_else"),
        node("inner", "if_else"),
        node("leafOuterFalse", "code"),
        node("leafInnerTrue", "code"),
        node("leafInnerFalse", "code"),
        node("end", "end"),
      ];
      const baseEdges = [
        edge("e1", "entry", "q", "outer", "c"),
        edge("e2", "outer", "false", "leafOuterFalse", "g"),
        edge("e3", "outer", "true", "inner", "c"),
        edge("e4", "inner", "true", "leafInnerTrue", "g"),
        edge("e5", "inner", "false", "leafInnerFalse", "g"),
        edge("c1", "leafOuterFalse", "out", "end", "answer"),
        edge("c2", "leafInnerTrue", "out", "end", "answer"),
      ];
      expect(
        canConvergeOnInput({
          nodes,
          edges: baseEdges,
          connection: connection("leafInnerFalse", "out", "end", "answer"),
        }),
      ).toBe(true);
    });
  });
});
