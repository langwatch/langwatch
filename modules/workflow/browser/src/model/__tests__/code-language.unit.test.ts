import { describe, expect, it } from "vitest";

import { codeLanguageOf } from "../code-language.ts";
import { codeEditorLanguage } from "../code/code-editor-language.ts";

describe("codeLanguageOf", () => {
  describe("given a code node saved before JavaScript existed", () => {
    /**
     * @scenario "A node saved before JavaScript existed reads as Python"
     */
    it("reads as Python", () => {
      const parameters = [{ identifier: "code", value: "class Code:\n    pass\n" }];
      expect(codeLanguageOf({ parameters })).toBe("python");
    });
  });

  describe("given a code node with a language parameter", () => {
    /**
     * @scenario "A language parameter of javascript reads as JavaScript"
     */
    it("reads JavaScript", () => {
      const parameters = [{ identifier: "language", value: "javascript" }];
      expect(codeLanguageOf({ parameters })).toBe("javascript");
    });

    /**
     * @scenario "An unrecognised language reads as Python"
     */
    it("reads anything else as Python", () => {
      expect(codeLanguageOf({ parameters: [{ identifier: "language", value: "python" }] })).toBe(
        "python",
      );
      expect(codeLanguageOf({ parameters: [{ identifier: "language", value: "ruby" }] })).toBe(
        "python",
      );
    });
  });
});

describe("codeEditorLanguage", () => {
  /**
   * @scenario "JavaScript is edited as code.mjs with two-space tabs"
   */
  it("edits JavaScript in Monaco's javascript mode as code.mjs", () => {
    expect(codeEditorLanguage({ language: "javascript" })).toMatchObject({
      monacoLanguage: "javascript",
      fileName: "code.mjs",
      label: "JavaScript",
    });
  });

  /**
   * @scenario "A node without a language is edited as Python"
   */
  it("edits a node without a language as Python", () => {
    expect(codeEditorLanguage({ language: undefined })).toMatchObject({
      monacoLanguage: "python",
      fileName: "Code.py",
      technologies: ["python", "dspy"],
    });
  });
});
