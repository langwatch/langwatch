import { describe, expect, it } from "vitest";

import {
  LANGY_EMPTY_TURN_FALLBACK,
  langySilentTurnReplyFromParts,
} from "../langy-empty-turn.rules.ts";

describe("langySilentTurnReplyFromParts", () => {
  it("names the code access card when the turn ended on it", () => {
    expect(langySilentTurnReplyFromParts([{ type: "tool-code_access" }])).toBe(
      "I'm waiting for you to say how I should reach your code, on the card above.",
    );
  });

  it("names the question card when the turn ended on it, under either part shape", () => {
    const line = "I'm waiting for your answer on the card above before I go on.";
    expect(langySilentTurnReplyFromParts([{ type: "tool-question" }])).toBe(line);
    expect(langySilentTurnReplyFromParts([{ type: "dynamic-tool", toolName: "question" }])).toBe(
      line,
    );
  });

  /** @scenario "A turn whose lines were all said with the say tool is not an empty turn" */
  it("answers with the lines said through the say tool instead of a fallback", () => {
    expect(
      langySilentTurnReplyFromParts([
        { type: "tool-say", input: { text: "Looked at the traces." } },
        { type: "tool-code_access" },
        { type: "tool-say", input: { text: "Two spans failed." } },
      ]),
    ).toBe("Looked at the traces.\n\nTwo spans failed.");
  });

  it("falls back when there is no card or said line to point at", () => {
    expect(langySilentTurnReplyFromParts([])).toBe(LANGY_EMPTY_TURN_FALLBACK);
    expect(langySilentTurnReplyFromParts([{ type: "tool-say", input: { text: "  " } }])).toBe(
      LANGY_EMPTY_TURN_FALLBACK,
    );
  });
});
