/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it } from "vitest";

import { scenarioRunIdForConversation } from "../voice-call-record.rules.ts";

describe("scenarioRunIdForConversation", () => {
  describe("given two attempts with the same conversation id and one with a different id", () => {
    /** @scenario "The idempotency key is derived from the conversation id" */
    it("derives the same run id for the same conversation and a different one otherwise", () => {
      const a1 = scenarioRunIdForConversation("conv_abc");
      const a2 = scenarioRunIdForConversation("conv_abc");
      const b = scenarioRunIdForConversation("conv_xyz");

      expect(a1).toBe(a2);
      expect(a1).not.toBe(b);
      expect(a1.startsWith("voicecall_")).toBe(true);
    });
  });
});
