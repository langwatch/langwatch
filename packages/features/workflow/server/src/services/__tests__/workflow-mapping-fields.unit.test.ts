import { describe, expect, it } from "vitest";
import { WorkflowDslService } from "../workflow-dsl.service.ts";

const dslService = WorkflowDslService.create();

function graph(inputs: { identifier: string; type: string }[]) {
  return {
    spec_version: "1.4",
    name: "workflow",
    icon: "x",
    description: "Test workflow",
    version: "1.0",
    nodes: [
      {
        id: "entry",
        type: "entry",
        position: { x: 0, y: 0 },
        data: { name: "Entry", outputs: [{ identifier: "question", type: "str" }] },
      },
      { id: "end", type: "end", position: { x: 1, y: 0 }, data: { name: "End", inputs } },
    ],
    edges: [
      {
        id: "edge",
        source: "entry",
        sourceHandle: "outputs.question",
        target: "end",
        targetHandle: "inputs.question",
      },
    ],
    state: {},
  };
}

describe("workflow mapping fields", () => {
  it("preserves named multi-output fields instead of inventing an output field", () => {
    const outputFields = [
      { identifier: "answer", type: "str" },
      { identifier: "confidence", type: "float" },
    ];

    expect(dslService.mappingFields(graph(outputFields))).toEqual({
      inputFields: [{ identifier: "question", type: "str" }],
      outputFields,
      fieldsResolved: true,
    });
  });

  it.each([null, void 0, {}, { nodes: "corrupted" }])(
    "marks unreadable persisted graphs as unresolved: %j",
    (dsl) => {
      expect(dslService.mappingFields(dsl)).toEqual({
        inputFields: [],
        outputFields: [],
        fieldsResolved: false,
      });
    },
  );

  it("preserves a valid graph with no end outputs as resolved and empty", () => {
    expect(dslService.mappingFields(graph([]))).toEqual({
      inputFields: [{ identifier: "question", type: "str" }],
      outputFields: [],
      fieldsResolved: true,
    });
  });
});
