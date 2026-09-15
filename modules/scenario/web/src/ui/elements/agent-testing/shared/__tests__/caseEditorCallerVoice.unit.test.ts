/**
 * The seed mapping the Agent Testing scenario editor uses to read a stored
 * scenario's `callerVoice` column into the draft: absent or exactly-default
 * reads as `null` (block closed), anything else reads as the config (block
 * open with those values).
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it } from "vitest";
import { callerVoiceFromScenario } from "../../../../sections/agent-testing/cases/use-case-editor.ts";

describe("callerVoiceFromScenario", () => {
  describe("when the scenario never customized it", () => {
    it("reads null for an absent column", () => {
      expect(callerVoiceFromScenario(null)).toBeNull();
      expect(callerVoiceFromScenario(undefined)).toBeNull();
    });

    it("reads null for a stored config equal to the defaults", () => {
      expect(
        callerVoiceFromScenario({
          voiceModel: null,
          interruptProbability: 0,
          effects: "none",
        }),
      ).toBeNull();
    });
  });

  describe("when the scenario carries a customized caller voice", () => {
    it("reads the parsed config", () => {
      expect(
        callerVoiceFromScenario({
          voiceModel: "openai/nova",
          interruptProbability: 0.2,
          effects: "phone_line",
        }),
      ).toEqual({
        voiceModel: "openai/nova",
        interruptProbability: 0.2,
        effects: "phone_line",
      });
    });
  });
});
