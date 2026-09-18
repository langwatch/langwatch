import { VoiceTargetSchema } from "@langwatch/scenario-contract";
/** @vitest-environment node
 * VoiceTargetSchema discriminates on transport: each branch carries only
 * the credentials its transport can use.
 */
import { describe, expect, it } from "vitest";

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
