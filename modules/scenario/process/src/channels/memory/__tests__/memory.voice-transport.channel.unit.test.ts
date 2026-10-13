import type { CallRecord } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { MemoryVoiceTransportChannel } from "../memory.voice-transport.channel.ts";

const CREDENTIAL = { kind: "elevenlabs" as const, apiKey: "k", baseUrl: "https://el" };

const RECORD: CallRecord = {
  conversationId: "conv_1",
  transport: "elevenlabs_convai",
  startedAt: 0,
  endedAt: 1_000,
  durationMs: 1_000,
  turns: [{ role: "caller", text: "Hello" }],
  isCutAtLimit: false,
  source: "provider",
};

describe("MemoryVoiceTransportChannel", () => {
  describe("given a call record it was handed", () => {
    it("reads that record back for its conversation", async () => {
      const channel = MemoryVoiceTransportChannel.create([RECORD]);

      await expect(
        channel.getCallRecord({
          conversationId: "conv_1",
          credential: CREDENTIAL,
          audioProxyUrl: "/audio",
        }),
      ).resolves.toEqual(RECORD);
    });
  });

  describe("given a conversation it holds no record for", () => {
    it("refuses as not ready, as a provider still finishing the call does", async () => {
      const channel = MemoryVoiceTransportChannel.create();

      await expect(
        channel.getCallRecord({
          conversationId: "conv_2",
          credential: CREDENTIAL,
          audioProxyUrl: "/audio",
        }),
      ).rejects.toMatchObject({ code: "voice_call_record_not_ready" });
    });
  });

  describe("when a session is minted", () => {
    it("answers a signed url for the agent and remembers the mint", async () => {
      const channel = MemoryVoiceTransportChannel.create();

      const session = await channel.mintSession({ agentId: "agent_1", credential: CREDENTIAL });

      expect(session.signedUrl).toBe("memory://voice/agent_1");
      expect(channel.minted).toEqual([{ agentId: "agent_1" }]);
    });
  });
});
