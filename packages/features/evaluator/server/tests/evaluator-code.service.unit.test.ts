import { describe, expect, it } from "vitest";
import { EvaluatorCodeService } from "../src/services/evaluator-code.service";

const dsl = EvaluatorCodeService.buildDsl({
  name: "My Evaluator",
  workflowId: "code_evaluator_test",
  config: {
    code: "class Code: ...",
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    outputs: [
      { identifier: "passed", type: "bool" },
      { identifier: "score", type: "float" },
    ],
  },
});

describe("code evaluator DSL", () => {
  it("uses the injected workflow id and entry-code-end shape", () => {
    expect(dsl.workflow_id).toBe("code_evaluator_test");
    expect(dsl.nodes.map((node) => node.type)).toEqual(["entry", "code", "end"]);
  });

  it("carries the code and declares no required code outputs", () => {
    const code = dsl.nodes.find((node) => node.type === "code");
    expect(code?.data.outputs).toEqual([]);
    expect(code?.data.parameters).toContainEqual({
      identifier: "code",
      type: "code",
      value: "class Code: ...",
    });
  });

  it("connects inputs and the complete evaluator output contract", () => {
    expect(dsl.edges).toHaveLength(6);
    const end = dsl.nodes.find((node) => node.type === "end");
    expect(end?.data.inputs?.map((input) => input.identifier)).toEqual([
      "details",
      "passed",
      "score",
      "label",
    ]);
  });
});
