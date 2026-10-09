/**
 * The `code_access` tool bridge (ADR-129,
 * specs/langy/langy-code-access.feature) — which call the card hangs on, and
 * which of several calls the conversation is asking on right now.
 */
import { describe, expect, it } from "vitest";

import {
  codeAccessCallId,
  LANGY_CODE_ACCESS_CARD_ANSWER,
  latestCodeAccessCallId,
} from "../langyCodeAccessTool";

function call(id: string, state = "input-available") {
  return { type: "tool-code_access", state, toolCallId: id, input: {} };
}

/** A call the tool answered itself, because the folder was already connected. */
function answeredItself(id: string) {
  return {
    type: "tool-code_access",
    state: "output-available",
    toolCallId: id,
    input: {},
    output:
      "The user's folder is connected. Work with the local_* tools.\nfolder: /work/acme",
  };
}

/** A call that put the card up. */
function raisedTheCard(id: string) {
  return {
    type: "tool-code_access",
    state: "output-available",
    toolCallId: id,
    input: {},
    output: `${LANGY_CODE_ACCESS_CARD_ANSWER}\nThe card shows this command: npx langwatch langy --share-control`,
  };
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

describe("given a folder that is already connected", () => {
  describe("when Langy calls for code access again", () => {
    /** @scenario "Only the call that asked carries a card" */
    it("draws no card for the call the tool answered itself", () => {
      expect(codeAccessCallId([answeredItself("b")])).toBeNull();
    });

    /** @scenario "Only the call that asked carries a card" */
    it("leaves the card on the call that asked", () => {
      const messages = [
        { role: "assistant", parts: [raisedTheCard("a")] },
        {
          role: "user",
          parts: [{ type: "text", text: "Local folder connected" }],
        },
        { role: "assistant", parts: [answeredItself("b")] },
        { role: "assistant", parts: [answeredItself("c")] },
      ];
      expect(latestCodeAccessCallId(messages)).toBe("a");
    });

    it("still moves the card when the reader is asked again", () => {
      const messages = [
        { role: "assistant", parts: [raisedTheCard("a")] },
        { role: "assistant", parts: [raisedTheCard("b")] },
      ];
      expect(latestCodeAccessCallId(messages)).toBe("b");
    });
  });
});
