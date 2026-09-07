import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALLER_VOICE,
  isSelectableVoiceModel,
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

describe("isSelectableVoiceModel", () => {
  describe("given audio, realtime and chat models with credentials", () => {
    /** @scenario The voice model filter predicate keeps only credentialed audio or realtime models */
    it("keeps only the audio-tagged and realtime-tagged models", () => {
      const audio = { mode: "audio", hasCredentials: true };
      const realtime = { mode: "realtime", hasCredentials: true };
      const chat = { mode: "chat", hasCredentials: true };

      expect(isSelectableVoiceModel(audio)).toBe(true);
      expect(isSelectableVoiceModel(realtime)).toBe(true);
      expect(isSelectableVoiceModel(chat)).toBe(false);
    });
  });

  describe("when an audio model has no credentials", () => {
    it("is not selectable", () => {
      expect(
        isSelectableVoiceModel({ mode: "audio", hasCredentials: false }),
      ).toBe(false);
    });
  });
});
