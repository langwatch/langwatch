/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import type { Field } from "../../types/dsl";
import { buildInputMappings, applyMappingChange } from "../edgeMappingUtils";

const createEdge = ({
  source,
  target,
  sourceField,
  targetField,
}: {
  source: string;
  target: string;
  sourceField: string;
  targetField: string;
}): Edge => ({
  id: `edge-${source}-${target}-${targetField}`,
  source,
  target,
  sourceHandle: `outputs.${sourceField}`,
  targetHandle: `inputs.${targetField}`,
  type: "default",
});

const createField = ({
  identifier,
  value,
}: {
  identifier: string;
  value?: unknown;
}): Field => ({
  identifier,
  type: "str",
  ...(value !== undefined ? { value } : {}),
});

describe("edgeMappingUtils", () => {
  describe("buildInputMappings()", () => {
    describe("when only edges exist", () => {
      it("returns source mappings from edges", () => {
        const edges: Edge[] = [
          createEdge({
            source: "node_a",
            target: "node_b",
            sourceField: "output",
            targetField: "query",
          }),
        ];
        const inputs: Field[] = [createField({ identifier: "query" })];

        const result = buildInputMappings({
          nodeId: "node_b",
          edges,
          inputs,
        });

        expect(result).toEqual({
          query: { type: "source", sourceId: "node_a", path: ["output"] },
        });
      });
    });

    describe("when only field values exist", () => {
      it("returns value mappings from field.value", () => {
        const edges: Edge[] = [];
        const inputs: Field[] = [
          createField({ identifier: "query", value: "hello world" }),
        ];

        const result = buildInputMappings({
          nodeId: "node_b",
          edges,
          inputs,
        });

        expect(result).toEqual({
          query: { type: "value", value: "hello world" },
        });
      });
    });

    describe("when both edges and field values exist for the same input", () => {
      it("gives priority to edge (source) mapping", () => {
        const edges: Edge[] = [
          createEdge({
            source: "node_a",
            target: "node_b",
            sourceField: "output",
            targetField: "query",
          }),
        ];
        const inputs: Field[] = [
          createField({ identifier: "query", value: "stale value" }),
        ];

        const result = buildInputMappings({
          nodeId: "node_b",
          edges,
          inputs,
        });

        expect(result).toEqual({
          query: { type: "source", sourceId: "node_a", path: ["output"] },
        });
      });
    });

    describe("when field.value is empty or null", () => {
      it("ignores empty string values", () => {
        const edges: Edge[] = [];
        const inputs: Field[] = [
          createField({ identifier: "query", value: "" }),
        ];

        const result = buildInputMappings({
          nodeId: "node_b",
          edges,
          inputs,
        });

        expect(result).toEqual({});
      });

      it("ignores null values", () => {
        const edges: Edge[] = [];
        const inputs: Field[] = [
          createField({ identifier: "query", value: null }),
        ];

        const result = buildInputMappings({
          nodeId: "node_b",
          edges,
          inputs,
        });

        expect(result).toEqual({});
      });

      it("ignores undefined values", () => {
        const edges: Edge[] = [];
        const inputs: Field[] = [createField({ identifier: "query" })];

        const result = buildInputMappings({
          nodeId: "node_b",
          edges,
          inputs,
        });

        expect(result).toEqual({});
      });
    });
  });

  describe("applyMappingChange()", () => {
    describe("when applying a source mapping", () => {
      it("creates a new edge and clears field.value", () => {
        const currentEdges: Edge[] = [];
        const currentInputs: Field[] = [
          createField({ identifier: "query", value: "old value" }),
        ];

        const result = applyMappingChange({
          nodeId: "node_b",
          identifier: "query",
          mapping: {
            type: "source",
            sourceId: "node_a",
            path: ["output"],
          },
          currentEdges,
          currentInputs,
        });

        expect(result.edges).toHaveLength(1);
        expect(result.edges[0]).toMatchObject({
          source: "node_a",
          target: "node_b",
          sourceHandle: "outputs.output",
          targetHandle: "inputs.query",
          type: "default",
        });
        expect(result.inputs).toEqual([
          { identifier: "query", type: "str" },
        ]);
      });

      it("removes a previous edge for the same input", () => {
        const currentEdges: Edge[] = [
          createEdge({
            source: "node_old",
            target: "node_b",
            sourceField: "old_output",
            targetField: "query",
          }),
        ];
        const currentInputs: Field[] = [
          createField({ identifier: "query" }),
        ];

        const result = applyMappingChange({
          nodeId: "node_b",
          identifier: "query",
          mapping: {
            type: "source",
            sourceId: "node_a",
            path: ["output"],
          },
          currentEdges,
          currentInputs,
        });

        expect(result.edges).toHaveLength(1);
        expect(result.edges[0]).toMatchObject({
          source: "node_a",
          sourceHandle: "outputs.output",
        });
      });
    });

    describe("when applying a value mapping", () => {
      it("removes existing edge and sets field.value", () => {
        const currentEdges: Edge[] = [
          createEdge({
            source: "node_a",
            target: "node_b",
            sourceField: "output",
            targetField: "query",
          }),
        ];
        const currentInputs: Field[] = [
          createField({ identifier: "query" }),
        ];

        const result = applyMappingChange({
          nodeId: "node_b",
          identifier: "query",
          mapping: { type: "value", value: "hardcoded text" },
          currentEdges,
          currentInputs,
        });

        expect(result.edges).toHaveLength(0);
        expect(result.inputs).toEqual([
          { identifier: "query", type: "str", value: "hardcoded text" },
        ]);
      });
    });

    describe("when clearing a mapping (undefined)", () => {
      it("removes existing edge and clears field.value", () => {
        const currentEdges: Edge[] = [
          createEdge({
            source: "node_a",
            target: "node_b",
            sourceField: "output",
            targetField: "query",
          }),
        ];
        const currentInputs: Field[] = [
          createField({ identifier: "query", value: "stale" }),
        ];

        const result = applyMappingChange({
          nodeId: "node_b",
          identifier: "query",
          mapping: undefined,
          currentEdges,
          currentInputs,
        });

        expect(result.edges).toHaveLength(0);
        expect(result.inputs).toEqual([
          { identifier: "query", type: "str" },
        ]);
      });
    });
  });
});
