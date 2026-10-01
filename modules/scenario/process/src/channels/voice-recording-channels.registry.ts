import { HttpVoiceRecordingChannel } from "./http/http.voice-recording.channel.ts";
import { MemoryVoiceRecordingChannel } from "./memory/memory.voice-recording.channel.ts";

/** The two tiers behind `VoiceRecordingChannel`. */
export const voiceRecordingChannels = {
  live: HttpVoiceRecordingChannel,
  memory: MemoryVoiceRecordingChannel,
};
