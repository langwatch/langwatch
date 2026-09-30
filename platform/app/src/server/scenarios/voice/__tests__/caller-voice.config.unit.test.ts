import { describe, expect, it } from "vitest";
import {
  callerVoiceConfigSchema,
  DEFAULT_CALLER_VOICE,
  parseCallerVoiceConfig,
} from "../caller-voice.config";

describe("parseCallerVoiceConfig", () => {
  describe("when the stored value is null or undefined", () => {
    it("returns the defaults", () => {
      expect(parseCallerVoiceConfig(null)).toEqual(DEFAULT_CALLER_VOICE);
      expect(parseCallerVoiceConfig(undefined)).toEqual(DEFAULT_CALLER_VOICE);
    });
  });

  describe("when the stored value is a full config", () => {
    it("returns it unchanged", () => {
      const stored = {
        voiceModel: "openai/shimmer",
        interruptProbability: 0.2,
        effects: "phone_line" as const,
      };
      expect(parseCallerVoiceConfig(stored)).toEqual(stored);
    });
  });

  describe("when the stored value is partial", () => {
    it("fills the missing fields with defaults", () => {
      expect(parseCallerVoiceConfig({ interruptProbability: 0.5 })).toEqual({
        voiceModel: null,
        interruptProbability: 0.5,
        effects: "none",
      });
    });
  });

  describe("when the stored value is malformed", () => {
    it("falls back to defaults instead of throwing", () => {
      expect(parseCallerVoiceConfig({ effects: "not_an_effect" })).toEqual(
        DEFAULT_CALLER_VOICE,
      );
      expect(parseCallerVoiceConfig("garbage")).toEqual(DEFAULT_CALLER_VOICE);
    });
  });
});

describe("callerVoiceConfigSchema voiceModel shape", () => {
  describe("given a well-formed provider slash voice string", () => {
    /** @scenario The caller voice value validates the provider slash voice shape */
    it("accepts it and leaves it unchanged", () => {
      const result = callerVoiceConfigSchema.safeParse({
        voiceModel: "openai/nova",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.voiceModel).toBe("openai/nova");
    });
  });

  describe("when the value is not a provider slash voice string", () => {
    /** @scenario The caller voice value validates the provider slash voice shape */
    it("rejects a bare name and a value with no voice segment", () => {
      expect(
        callerVoiceConfigSchema.safeParse({ voiceModel: "nova" }).success,
      ).toBe(false);
      expect(
        callerVoiceConfigSchema.safeParse({ voiceModel: "openai/" }).success,
      ).toBe(false);
    });
  });

  describe("when the value is null", () => {
    it("accepts it as the project default", () => {
      const result = callerVoiceConfigSchema.safeParse({ voiceModel: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.voiceModel).toBeNull();
    });
  });
});
