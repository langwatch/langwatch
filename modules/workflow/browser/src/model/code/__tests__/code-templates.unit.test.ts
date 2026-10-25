import type { Field } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { codeTemplate, switchCodeLanguage } from "../code-templates.ts";

const inputs = [{ identifier: "question", type: "str" }];
const outputs = [{ identifier: "answer", type: "str" }];

function nodeIn({ language, code }: { language: string; code: string }): Field[] {
  return [
    { identifier: "language", type: "str", value: language },
    { identifier: "code", type: "code", value: code },
  ];
}

const codeOf = (parameters: Field[]) => parameters.find((p) => p.identifier === "code")?.value;
const languageOf = (parameters: Field[]) =>
  parameters.find((p) => p.identifier === "language")?.value;

describe("switchCodeLanguage", () => {
  describe("given a node still holding its template", () => {
    /** @scenario "Switching an untouched code node's language swaps in that language's template" */
    it("swaps in the new language's template, named after the node's fields", () => {
      const js = codeTemplate({ language: "javascript", input: "question", output: "answer" });

      const ts = switchCodeLanguage({
        parameters: nodeIn({ language: "javascript", code: js }),
        inputs,
        outputs,
        to: "typescript",
      });

      expect(languageOf(ts)).toBe("typescript");
      expect(codeOf(ts)).toBe(
        codeTemplate({ language: "typescript", input: "question", output: "answer" }),
      );

      const python = switchCodeLanguage({ parameters: ts, inputs, outputs, to: "python" });
      expect(codeOf(python)).toContain("def __call__(self, question: str = None):");
      expect(codeOf(python)).toContain('return {"answer": "Hello world!"}');
    });
  });

  describe("given code the author wrote", () => {
    /** @scenario "Switching a code node's language keeps the code the author wrote" */
    it("keeps the code and changes only the language", () => {
      const written = "export default ({ question }) => ({ answer: question.trim() });\n";

      const next = switchCodeLanguage({
        parameters: nodeIn({ language: "javascript", code: written }),
        inputs,
        outputs,
        to: "typescript",
      });

      expect(languageOf(next)).toBe("typescript");
      expect(codeOf(next)).toBe(written);
    });
  });

  describe("given a node from before languages", () => {
    it("treats it as Python and swaps an untouched template", () => {
      const legacy: Field[] = [
        {
          identifier: "code",
          type: "code",
          value: codeTemplate({ language: "python", input: "question", output: "answer" }),
        },
      ];

      const next = switchCodeLanguage({ parameters: legacy, inputs, outputs, to: "javascript" });

      expect(languageOf(next)).toBe("javascript");
      expect(codeOf(next)).toContain("export default async function ({ question })");
    });
  });
});
