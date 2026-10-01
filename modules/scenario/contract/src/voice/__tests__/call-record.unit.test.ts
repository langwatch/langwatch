/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it } from "vitest";

import { browserTranscriptToCallRecord } from "../call-record.ts";

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
        isCutAtLimit: true,
      });

      expect(record.source).toBe("browser");
      expect(record.durationMs).toBe(3000);
      expect(record.isCutAtLimit).toBe(true);
      expect(record.audioUrl).toBeUndefined();
      expect(record.turns).toEqual([
        { role: "caller", text: "hello" },
        { role: "agent", text: "hi there" },
      ]);
    });
  });
});
