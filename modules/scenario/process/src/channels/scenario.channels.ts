import type { AgentTestTurnChild } from "../app/scenario.app.ts";
import type { ScenarioChildChannel, ScenarioGoChildChannel } from "./scenario-child.channel.ts";
import type { VoiceRecordingChannel } from "./voice-recording.channel.ts";

/** Every channel scenario holds, as the container hands them to the module class. */
export interface ScenarioChannels {
  readonly recordings: VoiceRecordingChannel;
  /** A run's child on the Node runtime (apps/scenario-child). */
  readonly nodeChildren: ScenarioChildChannel;
  /** A run's child on the Go runner, where the deployment ships its binary. */
  readonly goChildren: ScenarioGoChildChannel;
  /** One agent-test turn in a fresh Node child. */
  readonly agentTestTurns: AgentTestTurnChild;
}
