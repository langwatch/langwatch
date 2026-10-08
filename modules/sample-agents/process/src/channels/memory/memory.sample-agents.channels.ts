import type { SampleAgentsChannels } from "../sample-agents.channels.ts";
import { MemoryOpenAiChatChannel } from "./memory.openai-chat.channel.ts";
import { MemoryTraceCollectorChannel } from "./memory.trace-collector.channel.ts";

/** Model calls and trace posts are recorded in-process; nothing leaves the machine. */
export class MemorySampleAgentsChannels {
  static readonly requires = [] as const;

  static create(): SampleAgentsChannels {
    return {
      chat: MemoryOpenAiChatChannel.create(),
      collector: MemoryTraceCollectorChannel.create(),
    };
  }
}
