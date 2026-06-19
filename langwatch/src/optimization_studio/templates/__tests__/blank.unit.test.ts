import { describe, expect, it } from "vitest";
import { blankTemplate } from "../blank";

const node = (id: string) => blankTemplate.nodes.find((n) => n.id === id);

const param = ({
  nodeId,
  identifier,
}: {
  nodeId: string;
  identifier: string;
}) =>
  (
    node(nodeId)?.data as {
      parameters: Array<{ identifier: string; value: unknown }>;
    }
  ).parameters.find((p) => p.identifier === identifier)?.value;

describe("blankTemplate", () => {
  describe("given a blank workflow template", () => {
    describe("when inspecting the entry point", () => {
      /** @scenario Blank workflow entry exposes a single input */
      it("exposes a single input output", () => {
        expect((node("entry")?.data as { outputs: unknown }).outputs).toEqual([
          { identifier: "input", type: "str" },
        ]);
      });
    });

    describe("when inspecting the LLM node", () => {
      /** @scenario Blank workflow LLM node uses the default assistant prompt */
      it("uses the default helpful-assistant instructions", () => {
        expect(param({ nodeId: "llm_call", identifier: "instructions" })).toBe(
          "You are a helpful assistant.",
        );
      });

      it("sends a single input user message", () => {
        expect(param({ nodeId: "llm_call", identifier: "messages" })).toEqual([
          { role: "user", content: "{{input}}" },
        ]);
      });

      it("names its input and output input/output", () => {
        expect((node("llm_call")?.data as { inputs: unknown }).inputs).toEqual([
          { identifier: "input", type: "str" },
        ]);
        expect(
          (node("llm_call")?.data as { outputs: unknown }).outputs,
        ).toEqual([{ identifier: "output", type: "str" }]);
      });
    });

    describe("when inspecting the wiring", () => {
      /** @scenario Blank workflow wires the input through to the end output */
      it("wires the entry input into the LLM node", () => {
        expect(blankTemplate.edges).toContainEqual(
          expect.objectContaining({
            source: "entry",
            sourceHandle: "outputs.input",
            target: "llm_call",
            targetHandle: "inputs.input",
          }),
        );
      });

      it("wires the LLM output into the end node output", () => {
        expect(blankTemplate.edges).toContainEqual(
          expect.objectContaining({
            source: "llm_call",
            sourceHandle: "outputs.output",
            target: "end",
            targetHandle: "inputs.output",
          }),
        );
      });
    });
  });
});
