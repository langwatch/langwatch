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

const edge = ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
}: {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}): Edge => ({
  id,
  source,
  target,
  sourceHandle: `outputs.${sourceHandle}`,
  targetHandle: `inputs.${targetHandle}`,
  type: "default",
});

const connection = ({
  source,
  sourceHandle,
  target,
  targetHandle,
}: {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}): Connection => ({
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
  edge({
    id: "e1",
    source: "entry",
    sourceHandle: "q",
    target: "gate",
    targetHandle: "context",
  }),
  edge({
    id: "e2",
    source: "gate",
    sourceHandle: "true",
    target: "codeA",
    targetHandle: "gate",
  }),
  edge({
    id: "e3",
    source: "gate",
    sourceHandle: "false",
    target: "codeB",
    targetHandle: "gate",
  }),
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
        edge({
          id: "m1",
          source: "codeA",
          sourceHandle: "out",
          target: "merge",
          targetHandle: "x",
        }),
        edge({
          id: "m2",
          source: "codeB",
          sourceHandle: "out",
          target: "merge",
          targetHandle: "x",
        }),
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
        edge({
          id: "b1",
          source: "gate",
          sourceHandle: "true",
          target: "either",
          targetHandle: "x",
        }),
        edge({
          id: "b2",
          source: "gate",
          sourceHandle: "false",
          target: "either",
          targetHandle: "x",
        }),
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
        edge({
          id: "e1",
          source: "entry",
          sourceHandle: "q",
          target: "outer",
          targetHandle: "c",
        }),
        edge({
          id: "e2",
          source: "outer",
          sourceHandle: "true",
          target: "inner",
          targetHandle: "c",
        }),
        edge({
          id: "e3",
          source: "inner",
          sourceHandle: "true",
          target: "leaf",
          targetHandle: "g",
        }),
      ];
      const guards = computeNodeGuards({ nodes, edges });
      expect(guards.get("inner")).toEqual(new Set(["outer:true"]));
      expect(guards.get("leaf")).toEqual(new Set(["outer:true", "inner:true"]));
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
          connection: connection({
            source: "codeA",
            sourceHandle: "out",
            target: "end",
            targetHandle: "answer",
          }),
        }),
      ).toBe(true);
    });
  });

  describe("when the existing source is on the opposite branch", () => {
    it("allows two mutually exclusive branches to converge", () => {
      const edges = [
        ...forkEdges,
        edge({
          id: "conv",
          source: "codeA",
          sourceHandle: "out",
          target: "end",
          targetHandle: "answer",
        }),
      ];
      expect(
        canConvergeOnInput({
          nodes: forkNodes,
          edges,
          connection: connection({
            source: "codeB",
            sourceHandle: "out",
            target: "end",
            targetHandle: "answer",
          }),
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
        edge({
          id: "e1",
          source: "entry",
          sourceHandle: "q",
          target: "x",
          targetHandle: "in",
        }),
        edge({
          id: "e2",
          source: "entry",
          sourceHandle: "q",
          target: "y",
          targetHandle: "in",
        }),
        edge({
          id: "conv",
          source: "x",
          sourceHandle: "out",
          target: "end",
          targetHandle: "answer",
        }),
      ];
      expect(
        canConvergeOnInput({
          nodes,
          edges,
          connection: connection({
            source: "y",
            sourceHandle: "out",
            target: "end",
            targetHandle: "answer",
          }),
        }),
      ).toBe(false);
    });
  });

  describe("when both edges come from the same node", () => {
    /** @scenario Two outputs of the same node cannot converge on one input */
    it("rejects two outputs of one node on the same input", () => {
      const edges = [
        ...forkEdges,
        edge({
          id: "conv",
          source: "codeA",
          sourceHandle: "out1",
          target: "end",
          targetHandle: "answer",
        }),
      ];
      expect(
        canConvergeOnInput({
          nodes: forkNodes,
          edges,
          connection: connection({
            source: "codeA",
            sourceHandle: "out2",
            target: "end",
            targetHandle: "answer",
          }),
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
        edge({
          id: "e1",
          source: "entry",
          sourceHandle: "q",
          target: "outer",
          targetHandle: "c",
        }),
        edge({
          id: "e2",
          source: "outer",
          sourceHandle: "false",
          target: "leafOuterFalse",
          targetHandle: "g",
        }),
        edge({
          id: "e3",
          source: "outer",
          sourceHandle: "true",
          target: "inner",
          targetHandle: "c",
        }),
        edge({
          id: "e4",
          source: "inner",
          sourceHandle: "true",
          target: "leafInnerTrue",
          targetHandle: "g",
        }),
        edge({
          id: "e5",
          source: "inner",
          sourceHandle: "false",
          target: "leafInnerFalse",
          targetHandle: "g",
        }),
        edge({
          id: "c1",
          source: "leafOuterFalse",
          sourceHandle: "out",
          target: "end",
          targetHandle: "answer",
        }),
        edge({
          id: "c2",
          source: "leafInnerTrue",
          sourceHandle: "out",
          target: "end",
          targetHandle: "answer",
        }),
      ];
      expect(
        canConvergeOnInput({
          nodes,
          edges: baseEdges,
          connection: connection({
            source: "leafInnerFalse",
            sourceHandle: "out",
            target: "end",
            targetHandle: "answer",
          }),
        }),
      ).toBe(true);
    });
  });
});
