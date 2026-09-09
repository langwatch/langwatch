import { describe, expect, it } from "vitest";

import {
  parseVoiceAgentConfig,
  voiceAgentConfigSchema,
} from "../voice-agent.config";

describe("voiceAgentConfigSchema", () => {
  describe("given an ElevenLabs transport with a 1-128 character agent id", () => {
    describe("when the config is validated", () => {
      /** @scenario "A voice agent config with a trimmed agent id is valid" */
      it("accepts it and trims the agent id", () => {
        const parsed = parseVoiceAgentConfig({
          transport: "elevenlabs_convai",
          agentId: "  agent_123  ",
        });
        expect(parsed).toEqual({
          transport: "elevenlabs_convai",
          agentId: "agent_123",
        });
      });
    });
  });

  describe("given an agent id that is empty after trimming", () => {
    describe("when the config is validated", () => {
      /** @scenario "A voice agent config with an empty agent id is rejected" */
      it("rejects it", () => {
        const result = voiceAgentConfigSchema.safeParse({
          transport: "elevenlabs_convai",
          agentId: "   ",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("given a transport that is not a known member of the union", () => {
    describe("when the config is validated", () => {
      /** @scenario "A voice agent config with an unrecognised transport is rejected" */
      it("rejects it", () => {
        const result = voiceAgentConfigSchema.safeParse({
          transport: "phone",
          agentId: "agent_123",
        });
        expect(result.success).toBe(false);
      });
    });
  });
});
