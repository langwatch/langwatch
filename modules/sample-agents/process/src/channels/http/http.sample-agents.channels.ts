import type { SampleAgentsServerConfig } from "@langwatch/sample-agents-contract";
import { openAiApiKey, type ScopedSecrets } from "@langwatch/secrets";

import type { SampleAgentsChannels } from "../sample-agents.channels.ts";
import { HttpOpenAiChatChannel } from "./http.openai-chat.channel.ts";
import { HttpTraceCollectorChannel } from "./http.trace-collector.channel.ts";

/** Model calls go to OpenAI on the platform key; traces post to this deployment's collector. */
export class HttpSampleAgentsChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: SampleAgentsServerConfig;
    secrets: ScopedSecrets;
  }): Promise<SampleAgentsChannels> {
    const chat = await secrets.into(openAiApiKey, (apiKey) =>
      HttpOpenAiChatChannel.create({ apiKey }),
    );
    return { chat, collector: HttpTraceCollectorChannel.create({ baseUrl: config.publicBaseUrl }) };
  }
}
