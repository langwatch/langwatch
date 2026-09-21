import { describe, expect, it } from "vitest";

import {
  parseVoiceAgentConfig,
  voiceAgentConfigSchema,
  voiceAgentExternalId,
} from "../voice-agent.config.ts";

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
          transport: "carrier_pigeon",
          agentId: "agent_123",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("given a phone transport with an E.164 number", () => {
    describe("when the config is validated", () => {
      /** @scenario "A phone target stores its number in E.164 form" */
      it("accepts it and trims the number", () => {
        const parsed = parseVoiceAgentConfig({
          transport: "phone",
          phoneNumber: "  +14155550123  ",
        });
        expect(parsed).toEqual({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "outbound",
        });
      });
    });
  });

  describe("given a phone transport and no call direction", () => {
    describe("when the config is validated", () => {
      it("defaults the call direction to outbound", () => {
        const parsed = parseVoiceAgentConfig({
          transport: "phone",
          phoneNumber: "+14155550123",
        });
        expect(parsed).toEqual({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "outbound",
        });
      });
    });
  });

  describe("given a phone transport with an explicit call direction", () => {
    describe("when the config is validated", () => {
      it("round-trips inbound", () => {
        expect(
          parseVoiceAgentConfig({
            transport: "phone",
            phoneNumber: "+14155550123",
            callDirection: "inbound",
          }),
        ).toEqual({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "inbound",
        });
      });

      it("round-trips outbound", () => {
        expect(
          parseVoiceAgentConfig({
            transport: "phone",
            phoneNumber: "+14155550123",
            callDirection: "outbound",
          }),
        ).toEqual({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "outbound",
        });
      });
    });
  });

  describe("given a legacy phone config with the old agent-speaks-first flag on", () => {
    describe("when the config is validated", () => {
      it("maps isAgentSpeaksFirst true to inbound and drops the legacy key", () => {
        const parsed = parseVoiceAgentConfig({
          transport: "phone",
          phoneNumber: "+14155550123",
          isAgentSpeaksFirst: true,
        });
        expect(parsed).toEqual({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "inbound",
        });
      });

      it("maps the older agentSpeaksFirst true to inbound and drops the legacy key", () => {
        const parsed = parseVoiceAgentConfig({
          transport: "phone",
          phoneNumber: "+14155550123",
          agentSpeaksFirst: true,
        });
        expect(parsed).toEqual({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "inbound",
        });
      });
    });
  });

  describe("given a legacy phone config with the old agent-speaks-first flag off", () => {
    describe("when the config is validated", () => {
      it("defaults to outbound and drops the legacy key", () => {
        const parsed = parseVoiceAgentConfig({
          transport: "phone",
          phoneNumber: "+14155550123",
          isAgentSpeaksFirst: false,
        });
        expect(parsed).toEqual({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "outbound",
        });
      });
    });
  });

  describe("given both the new call direction and the legacy flag", () => {
    describe("when the config is validated", () => {
      it("keeps the explicit call direction and ignores the legacy flag", () => {
        const parsed = parseVoiceAgentConfig({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "outbound",
          isAgentSpeaksFirst: true,
        });
        expect(parsed).toEqual({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "outbound",
        });
      });
    });
  });

  describe("given a phone transport whose number is not E.164", () => {
    describe("when the config is validated", () => {
      /** @scenario "A phone target rejects a number that is not E.164" */
      it("rejects it", () => {
        const rejected = ["415-555-0123", "+0123456789", "+1234567890123456"];
        for (const phoneNumber of rejected) {
          const result = voiceAgentConfigSchema.safeParse({
            transport: "phone",
            phoneNumber,
          });
          expect(result.success).toBe(false);
        }
      });
    });
  });
});

describe("voiceAgentExternalId", () => {
  describe("given an ElevenLabs transport", () => {
    it("returns the agent id", () => {
      expect(
        voiceAgentExternalId({
          transport: "elevenlabs_convai",
          agentId: "agent_123",
        }),
      ).toBe("agent_123");
    });
  });

  describe("given a phone transport", () => {
    it("returns the phone number", () => {
      expect(
        voiceAgentExternalId({
          transport: "phone",
          phoneNumber: "+14155550123",
          callDirection: "outbound",
        }),
      ).toBe("+14155550123");
    });
  });
});
