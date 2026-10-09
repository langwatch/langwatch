/**
 * @vitest-environment node
 *
 * `VoiceTargetSchema` is a discriminated union on `transport`: each branch
 * carries only the credential shape its transport can use, so a job payload
 * cannot ship a Twilio credential to the ElevenLabs runner or the reverse.
 *
 * @see specs/features/agents/voice-phone.feature
 */
import { describe, expect, it } from "vitest";
import { VoiceTargetSchema } from "../types";

describe("VoiceTargetSchema", () => {
  describe("when the target is an ElevenLabs agent", () => {
    it("parses it with its elevenlabs credential", () => {
      const parsed = VoiceTargetSchema.safeParse({
        transport: "elevenlabs_convai",
        agentId: "el_1",
        credential: {
          kind: "elevenlabs",
          apiKey: "k",
          baseUrl: "https://api.elevenlabs.io",
        },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("when the target is a phone number", () => {
    it("parses it with its twilio credential", () => {
      const parsed = VoiceTargetSchema.safeParse({
        transport: "phone",
        agentId: "+14155559999",
        credential: {
          kind: "twilio",
          accountSid: "AC123",
          authToken: "tok-secret",
          fromNumber: "+14155550000",
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts a null credential for a project with no Twilio provider", () => {
      const parsed = VoiceTargetSchema.safeParse({
        transport: "phone",
        agentId: "+14155559999",
        credential: null,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects a phone target carrying an ElevenLabs credential", () => {
      const parsed = VoiceTargetSchema.safeParse({
        transport: "phone",
        agentId: "+14155559999",
        credential: { kind: "elevenlabs", apiKey: "k", baseUrl: "https://x" },
      });
      expect(parsed.success).toBe(false);
    });
  });
});
