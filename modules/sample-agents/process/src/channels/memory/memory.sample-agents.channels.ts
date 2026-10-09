import type { SampleAgentsChannels } from "../sample-agents.channels.ts";
import type { CollectorTrace, TraceCollectorChannel } from "../trace-collector.channel.ts";
import { MemoryOpenAiChatChannel } from "./memory.openai-chat.channel.ts";

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

/** The collector in memory: every post is kept; `unreachable` makes the next post throw. */
export class MemoryTraceCollectorChannel implements TraceCollectorChannel {
  readonly posts: { authToken: string; trace: CollectorTrace }[] = [];
  unreachable = false;

  private constructor() {}

  static create(): MemoryTraceCollectorChannel {
    return new MemoryTraceCollectorChannel();
  }

  async post(input: { authToken: string; trace: CollectorTrace }): Promise<void> {
    if (this.unreachable) throw new Error("connect ECONNREFUSED /api/collector");
    this.posts.push(input);
  }
}
