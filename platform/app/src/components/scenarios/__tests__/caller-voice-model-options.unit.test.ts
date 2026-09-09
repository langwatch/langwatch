import { describe, expect, it } from "vitest";
import { CALLER_VOICES } from "~/server/scenarios/voice/caller-voice.config";
import { callerVoiceOptions } from "../caller-voice-model-options";

describe("callerVoiceOptions", () => {
  describe("when the project has an enabled OpenAI provider", () => {
    /** @scenario The Voice picker lists the OpenAI caller voices when the project has an OpenAI provider */
    it("offers every OpenAI caller voice with its capitalised label", () => {
      const { options, displayNames } = callerVoiceOptions([
        { provider: "openai", enabled: true },
      ]);

      const openaiVoices = CALLER_VOICES.filter((v) => v.provider === "openai");
      expect(options).toEqual(openaiVoices.map((v) => v.value));
      for (const voice of openaiVoices) {
        expect(displayNames[voice.value]).toBe(voice.label);
        expect(voice.value.startsWith("openai/")).toBe(true);
      }
      // "nova" capitalises to "Nova", never left lowercase.
      expect(displayNames["openai/nova"]).toBe("Nova");
    });
  });

  describe("when the provider is not enabled", () => {
    /** @scenario The Voice picker lists the OpenAI caller voices when the project has an OpenAI provider */
    it("offers no voices, so the picker shows its add-a-provider state", () => {
      expect(
        callerVoiceOptions([{ provider: "openai", enabled: false }]),
      ).toEqual({ options: [], displayNames: {} });
      expect(callerVoiceOptions([])).toEqual({ options: [], displayNames: {} });
    });
  });

  describe("when only a provider with no caller voices is enabled", () => {
    it("offers nothing for that provider", () => {
      expect(
        callerVoiceOptions([{ provider: "no-such-provider", enabled: true }]),
      ).toEqual({ options: [], displayNames: {} });
    });
  });
});
