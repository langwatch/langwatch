import type { ScenarioChannels } from "../scenario.channels.ts";
import { MemoryScenarioChildChannel } from "./memory.scenario-child.channel.ts";
import { MemoryVoiceRecordingChannel } from "./memory.voice-recording.channel.ts";

/** Call recordings are served in-process from the bytes a test seeds; no child is spawned. */
export class MemoryScenarioChannels {
  static readonly requires = [] as const;

  static create(): ScenarioChannels {
    const children = MemoryScenarioChildChannel.create();
    return {
      recordings: MemoryVoiceRecordingChannel.create(),
      nodeChildren: children,
      goChildren: children,
      agentTestTurns: children,
    };
  }
}
