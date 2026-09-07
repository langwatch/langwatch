import { describe, expect, it } from "vitest";
import { allLitellmModels } from "~/server/modelProviders/registry";
import { audioModelOptions } from "../caller-voice-model-options";

describe("audioModelOptions", () => {
  describe("when the project has an enabled audio provider", () => {
    /** @scenario The Voice picker lists only audio and realtime models the project has credentials for */
    it("offers only that provider's audio/realtime models, never chat models", () => {
      const options = audioModelOptions([
        { provider: "openai", enabled: true },
      ]);

      expect(options.length).toBeGreaterThan(0);
      // Every offered model is an audio/realtime model — a chat model can never
      // leak in, so the chat pickers elsewhere are unaffected.
      for (const id of options) {
        expect(["audio", "realtime"]).toContain(allLitellmModels[id]?.mode);
        expect(id.startsWith("openai/")).toBe(true);
      }
    });
  });

  describe("when the provider is not enabled", () => {
    it("offers none of its models", () => {
      expect(
        audioModelOptions([{ provider: "openai", enabled: false }]),
      ).toEqual([]);
      expect(audioModelOptions([])).toEqual([]);
    });
  });

  describe("when only a chat provider is enabled", () => {
    it("offers no models from a provider that has no audio models", () => {
      // A synthetic provider with no audio catalog entries yields nothing.
      expect(
        audioModelOptions([{ provider: "no-such-provider", enabled: true }]),
      ).toEqual([]);
    });
  });
});
