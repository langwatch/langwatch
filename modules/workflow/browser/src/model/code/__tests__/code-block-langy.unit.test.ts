/**
 * What a code block hands Langy: secret names only, and Langy only where it is on offer.
 * Spec: specs/langy/langy-studio-code-blocks.feature.
 */
import { STUDIO_CODE_MAX_BYTES } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  type CodeBlockSnapshot,
  codeBlockAskRequest,
  codeBlockReadAnswer,
  codeBlockSecretNames,
  isCodeLangyAvailable,
  MAX_ASK_CODE_LENGTH,
} from "../code-block-langy.ts";

const SECRET_VALUE = "sk-live-do-not-leak-0123456789";

function snapshotWith(overrides: Partial<CodeBlockSnapshot> = {}): CodeBlockSnapshot {
  return {
    subject: {
      nodeId: "code_1",
      nodeName: "Shout",
      lastError: "NameError: name 'x' is not defined",
    },
    language: "python",
    code: "class Code:\n    def __call__(self, question: str):\n        return {'answer': question}",
    savedCode: "class Code:\n    pass",
    inputs: [{ identifier: "question", type: "str" }],
    outputs: [{ identifier: "answer", type: "str" }],
    secretNames: ["OPENAI_KEY"],
    ...overrides,
  };
}

/** A read as the editor answers it, named by a token. */
const readAnswer = (snapshot: CodeBlockSnapshot) =>
  codeBlockReadAnswer({ ...snapshot, readToken: "read-1" });

describe("codeBlockSecretNames", () => {
  describe("given secrets list rows that carry more than a name", () => {
    /** @scenario "The ask and the read carry secret names, never secret values" */
    it("keeps the names, and neither the ask nor the read carries anything else", () => {
      const rows = [
        { name: "OPENAI_KEY", id: "secret_1", value: SECRET_VALUE, updatedAt: "2026-10-01" },
      ];
      const secretNames = codeBlockSecretNames(rows);
      const snapshot = snapshotWith({ secretNames });

      const ask = JSON.stringify(codeBlockAskRequest({ instruction: "Use the key", snapshot }));
      const read = JSON.stringify(readAnswer(snapshot));

      expect(secretNames).toEqual(["OPENAI_KEY"]);
      for (const handed of [ask, read]) {
        expect(handed).toContain("OPENAI_KEY");
        expect(handed).not.toContain(SECRET_VALUE);
        expect(handed).not.toContain("secret_1");
      }
    });
  });
});

describe("isCodeLangyAvailable", () => {
  /** @scenario "Langy is unavailable without its release flag or langy:create" */
  it.each([
    [{ flag: true, mayAsk: true, installed: true }, true],
    [{ flag: false, mayAsk: true, installed: true }, false],
    [{ flag: undefined, mayAsk: true, installed: true }, false],
    [{ flag: true, mayAsk: false, installed: true }, false],
    [{ flag: true, mayAsk: true, installed: false }, false],
  ])("answers %o with %s", (input, expected) => {
    expect(isCodeLangyAvailable(input)).toBe(expected);
  });
});

describe("codeBlockAskRequest", () => {
  describe("when the buffer is longer than the question carries", () => {
    it("cuts it and says the read answers the whole buffer", () => {
      const snapshot = snapshotWith({ code: "x".repeat(MAX_ASK_CODE_LENGTH + 10) });

      const { question = "" } = codeBlockAskRequest({ instruction: "Tidy it", snapshot });

      expect(question).toContain("[truncated: 10 more characters");
      expect(question).toContain("studio.code.read");
    });
  });

  describe("when the code holds a run of backticks", () => {
    it("fences it with a longer run, so the code cannot close the fence", () => {
      const snapshot = snapshotWith({ code: "s = '```'" });

      const { question = "" } = codeBlockAskRequest({ instruction: "Explain", snapshot });

      expect(question).toContain("````python");
    });
  });
});

describe("codeBlockReadAnswer", () => {
  it("says whether the buffer differs from the saved code", () => {
    expect(readAnswer(snapshotWith()).hasUnsavedChanges).toBe(true);
    expect(readAnswer(snapshotWith({ code: "same", savedCode: "same" })).hasUnsavedChanges).toBe(
      false,
    );
  });
});

describe("codeBlockReadAnswer for a large buffer", () => {
  /** @scenario "A code block too large to hand over is read without its code" */
  it("hands over code at the proposal cap and withholds a buffer too large to return", () => {
    const atCap = "a".repeat(STUDIO_CODE_MAX_BYTES);
    const fits = readAnswer(snapshotWith({ code: atCap }));
    expect(fits.codeTooLarge).toBe(false);
    expect(fits.code).toBe(atCap);

    const tooLarge = readAnswer(snapshotWith({ code: "é".repeat(40 * 1024) }));
    expect(tooLarge.codeTooLarge).toBe(true);
    expect(tooLarge.code).toBe("");
    expect(tooLarge.hasUnsavedChanges).toBe(true);
  });
});
