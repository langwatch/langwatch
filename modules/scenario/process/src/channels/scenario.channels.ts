import type { VoiceRecordingChannel } from "./voice-recording.channel.ts";

/** Every channel scenario holds, as the container hands them to the module class. */
export interface ScenarioChannels {
  readonly recordings: VoiceRecordingChannel;
}
