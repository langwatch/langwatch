/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it } from "vitest";
import {
  browserTranscriptToCallRecord,
  scenarioRunIdForConversation,
} from "../call-record";

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

describe("browserTranscriptToCallRecord", () => {
  describe("when the provider record is not available", () => {
    it("builds a browser-sourced record from the live transcript", () => {
      const record = browserTranscriptToCallRecord({
        conversationId: "conv_1",
        transport: "elevenlabs_convai",
        transcript: [
          { role: "caller", text: "hello" },
          { role: "agent", text: "hi there" },
        ],
        startedAt: 1000,
        endedAt: 4000,
        cutAtLimit: true,
      });

      expect(record.source).toBe("browser");
      expect(record.durationMs).toBe(3000);
      expect(record.cutAtLimit).toBe(true);
      expect(record.audioUrl).toBeUndefined();
      expect(record.turns).toEqual([
        { role: "caller", text: "hello" },
        { role: "agent", text: "hi there" },
      ]);
    });
  });
});
