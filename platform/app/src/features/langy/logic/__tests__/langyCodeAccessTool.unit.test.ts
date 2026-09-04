/**
 * The `code_access` tool bridge (ADR-129,
 * specs/langy/langy-code-access.feature) — which call the card hangs on, and
 * which of several calls the conversation is asking on right now.
 */
import { describe, expect, it } from "vitest";

import {
  codeAccessCallId,
  latestCodeAccessCallId,
} from "../langyCodeAccessTool";

function call(id: string, state = "input-available") {
  return { type: "tool-code_access", state, toolCallId: id, input: {} };
}

describe("given one message", () => {
  describe("when it carries two code access calls", () => {
    it("hangs the card on the last one", () => {
      expect(codeAccessCallId([call("a"), call("b")])).toBe("b");
    });
  });

  describe("when the call is still streaming its input", () => {
    it("hangs no card yet", () => {
      expect(codeAccessCallId([call("a", "input-streaming")])).toBeNull();
    });
  });
});

describe("given a conversation", () => {
  describe("when Langy asked once", () => {
    it("names that call as the live one", () => {
      const messages = [
        { role: "user", parts: [{ type: "text", text: "instrument me" }] },
        { role: "assistant", parts: [call("a")] },
      ];
      expect(latestCodeAccessCallId(messages)).toBe("a");
    });
  });

  describe("when Langy asked again in a later message", () => {
    it("names the newest call, so the earlier card reads as closed", () => {
      const messages = [
        { role: "assistant", parts: [call("a")] },
        { role: "user", parts: [{ type: "text", text: "ask me again" }] },
        { role: "assistant", parts: [call("b")] },
      ];
      expect(latestCodeAccessCallId(messages)).toBe("b");
    });
  });

  describe("when no message asked", () => {
    it("names no call", () => {
      const messages = [
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { role: "assistant", parts: [{ type: "text", text: "hello back" }] },
      ];
      expect(latestCodeAccessCallId(messages)).toBeNull();
    });
  });
});
