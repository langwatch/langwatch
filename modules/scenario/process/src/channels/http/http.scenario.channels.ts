import type { ScenarioServerConfig } from "@langwatch/scenario-contract";
import { nlpInternalSecret, type ScopedSecrets } from "@langwatch/secrets";

import { NodeAgentTestTurnChannel } from "../agent-test-turn.node.channel.ts";
import { GoScenarioChildChannel } from "../scenario-child.go.channel.ts";
import {
  NodeScenarioChildChannel,
  scenarioChildProcessConfig,
} from "../scenario-child.node.channel.ts";
import type { ScenarioChannels } from "../scenario.channels.ts";
import { HttpVoiceRecordingChannel } from "./http.voice-recording.channel.ts";

/** Call recordings stream from the voice provider over HTTP; runs spawn Node or Go children. */
export class HttpScenarioChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: ScenarioServerConfig;
    secrets: ScopedSecrets;
  }): Promise<ScenarioChannels> {
    const nlpInternal = await secrets.into(nlpInternalSecret, (secret) => secret);
    const childConfig = scenarioChildProcessConfig({ config, nlpInternalSecret: nlpInternal });
    return {
      recordings: HttpVoiceRecordingChannel.create(),
      nodeChildren: NodeScenarioChildChannel.create({ config: childConfig }),
      goChildren: GoScenarioChildChannel.create({
        config: childConfig,
        binaryPath: config.goRunnerPath,
      }),
      agentTestTurns: NodeAgentTestTurnChannel.create({ config: childConfig }),
    };
  }
}
