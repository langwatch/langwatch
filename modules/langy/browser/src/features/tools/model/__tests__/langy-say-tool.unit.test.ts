/**
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { describe, expect, it } from "vitest";

import { isSayToolPart, sayToolText } from "../langy-say-tool.ts";

const CLOSING_LINE = "All ready! Let me know if there is anything I can help with.";

function sayPart(state: string, text = CLOSING_LINE) {
  return { type: "tool-say", toolCallId: "call_1", state, input: { text } };
}

describe("the say part's text", () => {
  describe("given a say the worker refused", () => {
    /** @scenario "The closing line is refused before complete-path" */
    it("draws nothing for a say that errored, live and from the record", () => {
      expect(isSayToolPart(sayPart("output-error"))).toBe(true);
      expect(sayToolText(sayPart("output-error"))).toBeNull();
      expect(
        sayToolText({
          type: "dynamic-tool",
          toolName: "say",
          state: "output-error",
          input: { text: CLOSING_LINE },
        }),
      ).toBeNull();
    });

    /** @scenario "The closing line is refused before complete-path" */
    it("draws a say that was said, and nothing while its input streams", () => {
      expect(sayToolText(sayPart("output-available"))).toBe(CLOSING_LINE);
      expect(sayToolText(sayPart("input-available"))).toBe(CLOSING_LINE);
      expect(sayToolText(sayPart("input-streaming"))).toBeNull();
      expect(sayToolText(sayPart("output-available", "  "))).toBeNull();
    });
  });
});
