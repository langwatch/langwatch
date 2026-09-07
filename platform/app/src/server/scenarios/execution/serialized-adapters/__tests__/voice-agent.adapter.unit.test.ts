import type { AgentAdapter } from "@langwatch/scenario";
import { describe, expect, it, vi } from "vitest";
import type { voiceTransportRegistry } from "../../../voice/voice-transport.registry";
import type { VoiceAgentData } from "../../types";
import { createSerializedVoiceAgentAdapter } from "../voice-agent.adapter";

const fakeAdapter = { call: async () => "" } as unknown as AgentAdapter;

function fakeRegistry(
  createAgentAdapter = vi.fn(() => fakeAdapter),
): typeof voiceTransportRegistry {
  return {
    elevenlabs_convai: {
      missingKeyMessage: "No ElevenLabs key in this project",
      createAgentAdapter,
    },
  };
}

function voiceData(
  credential: { apiKey: string; baseUrl: string } | null,
): VoiceAgentData {
  return {
    type: "voice",
    agentId: "agent-row-1",
    voiceTarget: {
      transport: "elevenlabs_convai",
      agentId: "el-agent-abc",
      credential,
    },
    maxCallSeconds: 90,
  };
}

describe("createSerializedVoiceAgentAdapter", () => {
  describe("when the project has no ElevenLabs key", () => {
    /** @scenario A run with a wrong agent id or a removed key fails without hanging the pool */
    it("fails with the named no-key message", () => {
      expect(() =>
        createSerializedVoiceAgentAdapter({
          data: voiceData(null),
          registry: fakeRegistry(),
        }),
      ).toThrow("No ElevenLabs key in this project");
    });
  });

  describe("when the project has a key", () => {
    it("delegates to the transport with the agent id, credential and call budget", () => {
      const createAgentAdapter = vi.fn(() => fakeAdapter);
      const adapter = createSerializedVoiceAgentAdapter({
        data: voiceData({
          apiKey: "xi-key",
          baseUrl: "https://api.elevenlabs.io",
        }),
        registry: fakeRegistry(createAgentAdapter),
      });

      expect(adapter).toBe(fakeAdapter);
      expect(createAgentAdapter).toHaveBeenCalledWith({
        agentId: "el-agent-abc",
        credential: { apiKey: "xi-key", baseUrl: "https://api.elevenlabs.io" },
        maxCallSeconds: 90,
      });
    });
  });
});
