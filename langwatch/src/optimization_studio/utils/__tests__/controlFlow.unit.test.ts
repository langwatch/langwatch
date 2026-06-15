/**
 * @vitest-environment node
 */
import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  CONTROL_FLOW_EDGE_TYPE,
  CONTROL_FLOW_HANDLE_ID,
  isBranchConnectionOrigin,
  isBranchSourceHandle,
  isConnectionAllowed,
  isControlFlowConnection,
  isControlFlowEdge,
} from "../controlFlow";

const node = (id: string, type: string): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {},
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
      expect(isBranchSourceHandle(undefined)).toBe(false);
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
    });

    it("is false for a non-branch handle, a non-if/else node, or no node", () => {
      expect(
        isBranchConnectionOrigin({
          node: node("gate", "if_else"),
          handleId: "outputs.answer",
        }),
      ).toBe(false);
      expect(
        isBranchConnectionOrigin({
          node: node("code", "code"),
          handleId: "outputs.true",
        }),
      ).toBe(false);
      expect(
        isBranchConnectionOrigin({ node: undefined, handleId: "outputs.true" }),
      ).toBe(false);
    });
  });

  describe("isControlFlowConnection", () => {
    it("matches the reserved control handle target", () => {
      expect(
        isControlFlowConnection({ targetHandle: CONTROL_FLOW_HANDLE_ID }),
      ).toBe(true);
      expect(isControlFlowConnection({ targetHandle: "inputs.gate" })).toBe(
        false,
      );
    });
  });

  describe("isControlFlowEdge", () => {
    it("matches by edge type or control target handle", () => {
      expect(
        isControlFlowEdge({
          type: CONTROL_FLOW_EDGE_TYPE,
          targetHandle: null,
        } as Edge),
      ).toBe(true);
      expect(
        isControlFlowEdge({
          type: "default",
          targetHandle: CONTROL_FLOW_HANDLE_ID,
        } as Edge),
      ).toBe(true);
      expect(
        isControlFlowEdge({
          type: "default",
          targetHandle: "inputs.gate",
        } as Edge),
      ).toBe(false);
    });
  });

  describe("isConnectionAllowed", () => {
    const nodes = [node("gate", "if_else"), node("code", "code")];

    /** @scenario A branch handle only connects to control-flow targets */
    it("lets a branch land on a control handle but not on a data input", () => {
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "gate",
            sourceHandle: "outputs.true",
            targetHandle: CONTROL_FLOW_HANDLE_ID,
          },
        }),
      ).toBe(true);
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "gate",
            sourceHandle: "outputs.true",
            targetHandle: "inputs.question",
          },
        }),
      ).toBe(false);
    });

    it("lets the control handle accept only a branch source", () => {
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "code",
            sourceHandle: "outputs.answer",
            targetHandle: CONTROL_FLOW_HANDLE_ID,
          },
        }),
      ).toBe(false);
    });

    it("leaves ordinary data connections unaffected", () => {
      expect(
        isConnectionAllowed({
          nodes,
          connection: {
            source: "code",
            sourceHandle: "outputs.answer",
            targetHandle: "inputs.question",
          },
        }),
      ).toBe(true);
    });
  });
});
