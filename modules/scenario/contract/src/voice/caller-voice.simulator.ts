/** Maps scenario caller-voice config to SDK user-simulator config; vendor
 * agnostic OpenAI TTS with SDK audio effects (not ElevenLabs).
 */

import * as ScenarioRunner from "@langwatch/scenario";
import {
  type CallerVoiceConfig,
  DEFAULT_CALLER_VOICE_MODEL,
} from "./caller-voice.config.ts";

type AudioEffect = (audio: Uint8Array) => Uint8Array;

/** A stock ambience preset shipped with the SDK for the background-noise effect. */
const BACKGROUND_NOISE_PRESET = "office";

export function callerVoiceAudioEffects(
  effect: CallerVoiceConfig["effects"],
): AudioEffect[] {
  switch (effect) {
    case "phone_line":
      return [ScenarioRunner.voice.effects.phoneQuality()];
    case "background_noise":
      return [
        ScenarioRunner.voice.effects.backgroundNoise(BACKGROUND_NOISE_PRESET),
      ];
    case "none":
      return [];
  }
}

/**
 * The user-simulator voice config for a scenario's caller: the effective voice
 * (its own, else the project default), the interrupt probability, and the audio
 * effects. Spread into `userSimulatorAgent({ model, ... })` for a voice target.
 */
export interface CallerVoiceSimulatorConfig {
  voice: string;
  interruptProbability: number;
  audioEffects: AudioEffect[];
}

export function buildCallerVoiceSimulatorConfig(
  callerVoice: CallerVoiceConfig,
): CallerVoiceSimulatorConfig {
  return {
    voice: callerVoice.voiceModel ?? DEFAULT_CALLER_VOICE_MODEL,
    interruptProbability: callerVoice.interruptProbability,
    audioEffects: callerVoiceAudioEffects(callerVoice.effects),
  };
}
