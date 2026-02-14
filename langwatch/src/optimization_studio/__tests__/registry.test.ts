import { describe, expect, it } from "vitest";
import { MODULES } from "../registry";

describe("Optimization Studio Registry", () => {
  describe("signature (LLM Node) defaults", () => {
    const { signature } = MODULES;

    it("is named 'New Prompt' for unsaved drag-and-drop flow", () => {
      expect(signature.name).toBe("New Prompt");
    });

    it("has input field named 'input'", () => {
      expect(signature.inputs).toBeDefined();
      expect(signature.inputs).toHaveLength(1);
      expect(signature.inputs?.[0]).toEqual({
        identifier: "input",
        type: "str",
      });
    });

    it("has output field named 'output'", () => {
      expect(signature.outputs).toBeDefined();
      expect(signature.outputs).toHaveLength(1);
      expect(signature.outputs?.[0]).toEqual({
        identifier: "output",
        type: "str",
      });
    });

    it("has instructions parameter with default system prompt", () => {
      expect(signature.parameters).toBeDefined();
      const instructionsParam = signature.parameters?.find(
        (p) => p.identifier === "instructions",
      );

      expect(instructionsParam).toBeDefined();
      expect(instructionsParam?.value).toBe("You are a helpful assistant.");
    });

    it("has messages parameter with user message using {{input}}", () => {
      expect(signature.parameters).toBeDefined();
      const messagesParam = signature.parameters?.find(
        (p) => p.identifier === "messages",
      );

      expect(messagesParam).toBeDefined();
      expect(messagesParam?.value).toEqual([
        { role: "user", content: "{{input}}" },
      ]);
    });
  });

  describe("code block defaults", () => {
    const { code } = MODULES;

    it("has input field named 'input'", () => {
      expect(code.inputs).toBeDefined();
      expect(code.inputs).toHaveLength(1);
      expect(code.inputs?.[0]).toEqual({
        identifier: "input",
        type: "str",
      });
    });

    it("has output field named 'output'", () => {
      expect(code.outputs).toBeDefined();
      expect(code.outputs).toHaveLength(1);
      expect(code.outputs?.[0]).toEqual({
        identifier: "output",
        type: "str",
      });
    });

    it("has code parameter with input parameter in function signature", () => {
      expect(code.parameters).toBeDefined();
      const codeParam = code.parameters?.find((p) => p.identifier === "code");

      expect(codeParam).toBeDefined();
      expect(codeParam?.value).toContain("def forward(self, input: str)");
    });

    it("has code parameter returning output key", () => {
      expect(code.parameters).toBeDefined();
      const codeParam = code.parameters?.find((p) => p.identifier === "code");

      expect(codeParam).toBeDefined();
      expect(codeParam?.value).toContain('return {"output":');
    });
  });

  describe("unified naming consistency", () => {
    it("signature and code use same input/output naming", () => {
      const { signature, code } = MODULES;

      expect(signature.inputs).toBeDefined();
      expect(code.inputs).toBeDefined();
      expect(signature.outputs).toBeDefined();
      expect(code.outputs).toBeDefined();

      expect(signature.inputs?.[0]?.identifier).toBe(
        code.inputs?.[0]?.identifier,
      );
      expect(signature.outputs?.[0]?.identifier).toBe(
        code.outputs?.[0]?.identifier,
      );
    });
  });
});
