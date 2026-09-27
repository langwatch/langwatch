/**
 * @vitest-environment jsdom
 * Trace lends its conversation renderer through the declaration, so prompt and
 * scenario draw a thread without importing trace's browser package.
 */
import { uiDeclarations } from "@langwatch/browser-host/declarations";
import { describe, expect, it } from "vitest";

import { traceWeb } from "../trace.web.ts";
import { ConversationThread } from "../ui/sections/conversation/conversation-thread.tsx";

describe("the trace browser declaration", () => {
  describe("when a peer reads the conversationThread capability", () => {
    it("loads the conversation renderer", async () => {
      const [lent] = uiDeclarations([traceWeb]).declared("conversationThread");
      const loaded = await lent?.capability.load();

      expect(lent?.module).toBe("trace");
      expect(loaded?.default).toBe(ConversationThread);
    });
  });
});
