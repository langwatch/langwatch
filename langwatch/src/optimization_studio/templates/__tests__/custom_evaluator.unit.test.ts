import { describe, expect, it } from "vitest";
import { customEvaluatorTemplate } from "../custom_evaluator";

const node = (id: string) =>
  customEvaluatorTemplate.nodes.find((n) => n.id === id);

describe("customEvaluatorTemplate", () => {
  describe("the entry point", () => {
    /** @scenario Custom evaluator template entry exposes only a question input */
    it("exposes only a question output", () => {
      expect((node("entry")?.data as { outputs: unknown }).outputs).toEqual([
        { identifier: "question", type: "str" },
      ]);
    });

    /** @scenario Custom evaluator template has no attached dataset */
    it("has no attached dataset", () => {
      expect(
        (node("entry")?.data as { dataset?: unknown }).dataset,
      ).toBeUndefined();
    });
  });

  describe("the sample LLM node", () => {
    /** @scenario Custom evaluator template LLM input is named input */
    it("takes a single input named input", () => {
      expect((node("llm_call")?.data as { inputs: unknown }).inputs).toEqual([
        { identifier: "input", type: "str" },
      ]);
    });

    it("references the input in its prompt and drops llm_output", () => {
      const params = (
        node("llm_call")?.data as {
          parameters: Array<{ identifier: string; value: unknown }>;
        }
      ).parameters;
      const messages = JSON.stringify(
        params.find((p) => p.identifier === "messages")?.value,
      );
      expect(messages).toContain("{{input}}");
      expect(messages).not.toContain("llm_output");
    });
  });

  describe("the end node", () => {
    /** @scenario Custom evaluator template lists details first on the end node */
    it("puts details first so the reasoning edge does not cross the verdict", () => {
      expect(
        (
          node("end")?.data as { inputs: Array<{ identifier: string }> }
        ).inputs.map((i) => i.identifier),
      ).toEqual(["details", "passed", "score", "label"]);
    });
  });

  describe("the wiring", () => {
    /** @scenario Custom evaluator template wires reasoning into the end details */
    it("connects the LLM reasoning to the end details", () => {
      expect(customEvaluatorTemplate.edges).toContainEqual(
        expect.objectContaining({
          source: "llm_call",
          sourceHandle: "outputs.reasoning",
          target: "end",
          targetHandle: "inputs.details",
        }),
      );
    });

    it("connects the entry question to the LLM input", () => {
      expect(customEvaluatorTemplate.edges).toContainEqual(
        expect.objectContaining({
          source: "entry",
          sourceHandle: "outputs.question",
          target: "llm_call",
          targetHandle: "inputs.input",
        }),
      );
    });
  });

  describe("the node set", () => {
    /** @scenario Custom evaluator template has no extra ExactMatch evaluator */
    it("has only the entry, sample LLM and end nodes", () => {
      expect(customEvaluatorTemplate.nodes.map((n) => n.id).sort()).toEqual([
        "end",
        "entry",
        "llm_call",
      ]);
    });

    it("offsets the entry so the gaps around the sample node look balanced", () => {
      const x = (id: string) => node(id)!.position.x;
      expect(x("entry")).toBeLessThan(x("llm_call"));
      expect(x("llm_call")).toBeLessThan(x("end"));
      // The sample node is wider than entry, so its left edge sits closer to
      // entry than to end. A smaller entry-side left-edge gap yields an equal
      // visual gap on both sides.
      expect(x("entry")).toBeGreaterThan(0);
      expect(x("llm_call") - x("entry")).toBeLessThan(
        x("end") - x("llm_call"),
      );
    });
  });
});
