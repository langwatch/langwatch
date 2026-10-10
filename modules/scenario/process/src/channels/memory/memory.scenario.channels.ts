import type { ScenarioChannels } from "../scenario.channels.ts";
import { MemoryVoiceRecordingChannel } from "./memory.voice-recording.channel.ts";

/** Call recordings are served in-process from the bytes a test seeds. */
export class MemoryScenarioChannels {
  static readonly requires = [] as const;

  static create(): ScenarioChannels {
    return { recordings: MemoryVoiceRecordingChannel.create() };
  }
}
