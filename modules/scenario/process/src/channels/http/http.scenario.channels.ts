import type { ScenarioChannels } from "../scenario.channels.ts";
import { HttpVoiceRecordingChannel } from "./http.voice-recording.channel.ts";

/** Call recordings are streamed from the voice provider over HTTP. */
export class HttpScenarioChannels {
  static readonly requires = [] as const;

  static create(): ScenarioChannels {
    return { recordings: HttpVoiceRecordingChannel.create() };
  }
}
