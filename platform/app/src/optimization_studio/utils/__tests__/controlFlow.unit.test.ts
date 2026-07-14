/**
 * @vitest-environment node
 */
import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  GATE_HANDLE_ID,
  isBranchConnectionOrigin,
  isBranchSourceHandle,
  isConnectionAllowed,
  nodeHasGateInput,
  showsTemporaryGate,
} from "../controlFlow";

const node = (
  id: string,
  type: string,
  inputs: { identifier: string; type: string }[] = [],
): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { inputs },
});

describe("controlFlow helpers", () => {
  describe("isBranchSourceHandle", () => {
    it("matches the if/else branch handles", () => {
      expect(isBranchSourceHandle("outputs.true")).toBe(true);
      expect(isBranchSourceHandle("outputs.false")).toBe(true);
      expect(isBranchSourceHandle("true")).toBe(true);
    });

    it("rejects ordinary output handles", () => {
      expect(isBranchSourceHandle("outputs.answer")).toBe(false);
      expect(isBranchSourceHandle(null)).toBe(false);
    });
  });

  describe("isBranchConnectionOrigin", () => {
    it("is true only for a branch handle on an if/else node", () => {
      expect(
        isBranchConnectionOrigin({
          node: node("gate", "if_else"),
          handleId: "outputs.true",
        }),
      ).toBe(true);
      expect(
        isBranchConnectionOrigin({
          node: node("code", "code"),
          handleId: "outputs.true",
        }),
      ).toBe(false);
      expect(
        isBranchConnectionOrigin({
          node: node("gate", "if_else"),
          handleId: "outputs.answer",
        }),
      ).toBe(false);
    });
  });

  describe("nodeHasGateInput", () => {
    it("detects an existing gate input", () => {
      expect(
        nodeHasGateInput(
          node("c", "code", [{ identifier: "gate", type: "bool" }]),
        ),
      ).toBe(true);
      expect(
        nodeHasGateInput(
          node("c", "code", [{ identifier: "question", type: "str" }]),
        ),
      ).toBe(false);
    });
  });

  describe("showsTemporaryGate", () => {
    /** @scenario The temporary gate is not offered when the node already has one */
    it("offers a temporary gate only to connectable nodes without one", () => {
      const sourceId = "gate";
      expect(showsTemporaryGate({ node: node("code", "code"), sourceId })).toBe(
        true,
      );
      // already has a gate input
      expect(
        showsTemporaryGate({
          node: node("c2", "code", [{ identifier: "gate", type: "bool" }]),
          sourceId,
        }),
      ).toBe(false);
      // the drag's own source node
      expect(
        showsTemporaryGate({ node: node("gate", "if_else"), sourceId: "gate" }),
      ).toBe(false);
      // entry / prompting_technique are excluded
      expect(
        showsTemporaryGate({ node: node("entry", "entry"), sourceId }),
      ).toBe(false);
      expect(
        showsTemporaryGate({
          node: node("pt", "prompting_technique"),
          sourceId,
        }),
      ).toBe(false);
    });
  });

  describe("isConnectionAllowed", () => {
    const nodes = [
      node("gate", "if_else"),
      node("code", "code", [
        { identifier: "question", type: "str" },
        { identifier: "ready", type: "bool" },
      ]),
    ];

    /** @scenario A branch only connects to bool inputs */
    it("lets a branch land on a bool input or the gate, not on a non-bool input", () => {
      // existing bool input
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "gate",
            sourceHandle: "outputs.true",
            target: "code",
            targetHandle: "inputs.ready",
          },
        }),
      ).toBe(true);
      // the gate handle (temporary or real)
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "gate",
            sourceHandle: "outputs.true",
            target: "code",
            targetHandle: GATE_HANDLE_ID,
          },
        }),
      ).toBe(true);
      // a non-bool input
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "gate",
            sourceHandle: "outputs.true",
            target: "code",
            targetHandle: "inputs.question",
          },
        }),
      ).toBe(false);
    });

    it("rejects a branch self-connection", () => {
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "gate",
            sourceHandle: "outputs.true",
            target: "gate",
            targetHandle: GATE_HANDLE_ID,
          },
        }),
      ).toBe(false);
    });

    it("leaves ordinary (non-branch) connections unaffected", () => {
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "code",
            sourceHandle: "outputs.answer",
            target: "gate",
            targetHandle: "inputs.question",
          },
        }),
      ).toBe(true);
    });
  });
});
