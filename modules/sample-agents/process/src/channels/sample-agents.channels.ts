import type { OpenAiChatChannel } from "./openai-chat.channel.ts";
import type { TraceCollectorChannel } from "./trace-collector.channel.ts";

/** Every channel sample-agents holds, as the container hands them to the module class. */
export interface SampleAgentsChannels {
  readonly chat: OpenAiChatChannel;
  readonly collector: TraceCollectorChannel;
}
