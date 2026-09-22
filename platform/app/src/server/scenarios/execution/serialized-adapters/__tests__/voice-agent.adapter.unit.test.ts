import type { AgentAdapter } from "@langwatch/scenario";
import { describe, expect, it, vi } from "vitest";
import { phoneTransport } from "../../../voice/transports/phone.transport";
import type { voiceTransportRegistry } from "../../../voice/voice-transport.registry";
import type { VoiceAgentData } from "../../types";
import {
  createSerializedVoiceAgentAdapter,
  NO_OPENAI_KEY_MESSAGE,
} from "../voice-agent.adapter";

const fakeAdapter = { call: async () => "" } as unknown as AgentAdapter;

function fakeRegistry(
  createAgentAdapter = vi.fn(() => fakeAdapter),
): typeof voiceTransportRegistry {
  return {
    elevenlabs_convai: {
      missingKeyMessage: "No ElevenLabs key in this project",
      createAgentAdapter,
      mintSession: vi.fn(),
      fetchCallRecord: vi.fn(),
      endCall: vi.fn(),
    },
    phone: phoneTransport,
  };
}

function voiceData({
  credential,
  callerEnv = { OPENAI_API_KEY: "sk-openai" },
}: {
  credential: { kind: "elevenlabs"; apiKey: string; baseUrl: string } | null;
  callerEnv?: Record<string, string>;
}): VoiceAgentData {
  return {
    type: "voice",
    agentId: "agent-row-1",
    voiceTarget: {
      transport: "elevenlabs_convai",
      agentId: "el-agent-abc",
      credential,
    },
    callerEnv,
    maxCallSeconds: 90,
  };
}

describe("createSerializedVoiceAgentAdapter", () => {
  describe("given a serialized voice agent adapter", () => {
    describe("when the project has no ElevenLabs key", () => {
      /** @scenario A run with a wrong agent id or a removed key fails without hanging the pool */
      it("fails with the named no-key message", () => {
        expect(() =>
          createSerializedVoiceAgentAdapter({
            data: voiceData({ credential: null }),
            registry: fakeRegistry(),
          }),
        ).toThrow("No ElevenLabs key in this project");
      });
    });

    describe("when the project has an ElevenLabs key but no OpenAI key", () => {
      /** @scenario A voice run with no OpenAI key fails early with a named message */
      it("fails with the named no-OpenAI-key message before connecting", () => {
        expect(() =>
          createSerializedVoiceAgentAdapter({
            data: voiceData({
              credential: {
                kind: "elevenlabs",
                apiKey: "xi-key",
                baseUrl: "https://api.elevenlabs.io",
              },
              callerEnv: {},
            }),
            registry: fakeRegistry(),
          }),
        ).toThrow(NO_OPENAI_KEY_MESSAGE);
      });
    });

    describe("when the project has a key", () => {
      it("delegates to the transport with the agent id, credential and call budget", () => {
        const createAgentAdapter = vi.fn(() => fakeAdapter);
        const adapter = createSerializedVoiceAgentAdapter({
          data: voiceData({
            credential: {
              kind: "elevenlabs",
              apiKey: "xi-key",
              baseUrl: "https://api.elevenlabs.io",
            },
          }),
          registry: fakeRegistry(createAgentAdapter),
        });

        expect(adapter).toBe(fakeAdapter);
        expect(createAgentAdapter).toHaveBeenCalledWith({
          agentId: "el-agent-abc",
          credential: {
            kind: "elevenlabs",
            apiKey: "xi-key",
            baseUrl: "https://api.elevenlabs.io",
          },
          maxCallSeconds: 90,
        });
      });
    });
  });
});
