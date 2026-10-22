import { describe, expect, it } from "vitest";

import { codeLanguageOf } from "../model/code-language.ts";
import { MODULES } from "../model/studio-registry.ts";

describe("Optimization Studio Registry", () => {
  describe("given the signature (Prompt) module", () => {
    const { signature } = MODULES;

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
      const instructionsParam = signature.parameters?.find((p) => p.identifier === "instructions");

      expect(instructionsParam).toBeDefined();
      expect(instructionsParam?.value).toBe("You are a helpful assistant.");
    });

    it("has messages parameter with user message using {{input}}", () => {
      expect(signature.parameters).toBeDefined();
      const messagesParam = signature.parameters?.find((p) => p.identifier === "messages");

      expect(messagesParam).toBeDefined();
      expect(messagesParam?.value).toEqual([{ role: "user", content: "{{input}}" }]);
    });
  });

  describe("given the code block module", () => {
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

    const codeValue = () => code.parameters?.find((p) => p.identifier === "code")?.value as string;

    it("defaults a new code node to JavaScript", () => {
      const language = code.parameters?.find((p) => p.identifier === "language");

      expect(language).toEqual({ identifier: "language", type: "str", value: "javascript" });
      expect(codeLanguageOf({ parameters: code.parameters })).toBe("javascript");
    });

    it("ships a default export that destructures the input and returns the output", () => {
      expect(codeValue()).toContain("export default async function ({ input })");
      expect(codeValue()).toContain('return { output: "Hello world!" };');
    });

    it("types the entrypoint with the editor's Inputs and Outputs through JSDoc", () => {
      expect(codeValue()).toContain("@param {Inputs} inputs");
      expect(codeValue()).toContain("@returns {Promise<Outputs>}");
    });

    it("ships no Python in the JavaScript template", () => {
      expect(codeValue()).not.toMatch(/^class\s+\w+/m);
      expect(codeValue()).not.toContain("def __call__");
      expect(codeValue()).not.toContain("dspy");
    });
  });

  describe("given the if/else block module", () => {
    const { ifElse } = MODULES;

    /** @scenario If/Else is available in the node palette */
    it("registers the If/Else module for the node palette", () => {
      expect(ifElse.name).toBe("If/Else");
      expect(ifElse.inputs).toEqual([{ identifier: "input", type: "str" }]);
    });

    /** @scenario If/Else node has one condition and two output branches */
    it("ships a condition parameter and the fixed branch outputs", () => {
      const conditionParam = ifElse.parameters?.find((p) => p.identifier === "condition");
      expect(conditionParam).toBeDefined();
      expect(conditionParam?.type).toBe("str");

      // The branch handles are the engine's gating contract - fixed
      // identifiers true/false of type bool.
      expect(ifElse.outputs).toEqual([
        { identifier: "true", type: "bool" },
        { identifier: "false", type: "bool" },
      ]);
    });
  });

  describe("given every module in the registry", () => {
    it("signature and code use same input/output naming", () => {
      const { signature, code } = MODULES;

      expect(signature.inputs).toBeDefined();
      expect(code.inputs).toBeDefined();
      expect(signature.outputs).toBeDefined();
      expect(code.outputs).toBeDefined();

      expect(signature.inputs?.[0]?.identifier).toBe(code.inputs?.[0]?.identifier);
      expect(signature.outputs?.[0]?.identifier).toBe(code.outputs?.[0]?.identifier);
    });
  });
});
