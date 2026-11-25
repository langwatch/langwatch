/**
 * @vitest-environment jsdom
 * Trace lends by the tokens in its client package, so a reader draws trace's UI
 * without importing trace's browser package or naming a capability (§10.1).
 */
import {
  AgentActionsMenuToken,
  AnnotationQueueConversationToken,
  ConversationThreadToken,
  RenderInputOutputToken,
  SetupWithAgentButtonToken,
  TraceEditButtonToken,
  TraceIdPeekToken,
  TracePreviewHoverCardToken,
} from "@langwatch/trace-client";
import { describe, expect, it } from "vitest";

import { traceWeb } from "../trace.web.ts";
import { ConversationThread } from "../ui/sections/conversation/conversation-thread.tsx";

async function loadLent({ key }: { key: string }) {
  const lend = traceWeb.installation.lends.find(({ token }) => token.key === key);
  return lend && "load" in lend ? lend.load() : undefined;
}

describe("the trace browser declaration", () => {
  describe("when a reader looks up each token from trace's client", () => {
    /** @scenario Trace and coding-agent lend by their client tokens */
    it.each([
      AgentActionsMenuToken,
      AnnotationQueueConversationToken,
      ConversationThreadToken,
      RenderInputOutputToken,
      SetupWithAgentButtonToken,
      TraceEditButtonToken,
      TraceIdPeekToken,
      TracePreviewHoverCardToken,
    ])("loads the lent component for $key", async (token) => {
      const loaded = await loadLent(token);

      expect(loaded).toHaveProperty("default");
    });

    /** @scenario Trace and coding-agent lend by their client tokens */
    it("lends its conversation renderer under the conversation thread token", async () => {
      const loaded = await loadLent(ConversationThreadToken);

      expect(loaded).toEqual({ default: ConversationThread });
    });
  });
});
