import type { ChatCompletion, ChatMessage, OpenAiChatChannel } from "../openai-chat.channel.ts";

/**
 * OpenAI in memory: every call is kept, and each answers `reply` numbered by
 * call. `failing` makes every call throw the way a refused key does.
 */
export class MemoryOpenAiChatChannel implements OpenAiChatChannel {
  readonly calls: { model: string; messages: readonly ChatMessage[] }[] = [];
  failing = false;

  private constructor(private readonly createdSeconds: number) {}

  static create({
    createdSeconds = 1_700_000_000,
  }: { createdSeconds?: number } = {}): MemoryOpenAiChatChannel {
    return new MemoryOpenAiChatChannel(createdSeconds);
  }

  async complete(input: {
    model: string;
    messages: readonly ChatMessage[];
  }): Promise<ChatCompletion> {
    if (this.failing) throw new Error("401 Incorrect API key provided");
    this.calls.push(input);
    return {
      model: input.model,
      createdSeconds: this.createdSeconds,
      content: `reply ${this.calls.length}`,
      promptTokens: 10,
      completionTokens: 20,
    };
  }
}
