import { z } from "zod";

import type { ChatCompletion, ChatMessage, OpenAiChatChannel } from "../openai-chat.channel.ts";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/** Long enough for a slow completion, short enough that a hung call does not hold the request. */
const COMPLETION_TIMEOUT_MS = 60_000;

const completionResponseSchema = z.object({
  model: z.string(),
  created: z.number(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }),
});

/** The request seam, injected so a suite never opens a socket. */
export type OpenAiChatFetch = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;

export class HttpOpenAiChatChannel implements OpenAiChatChannel {
  private constructor(
    private readonly apiKey: string | undefined,
    private readonly send: OpenAiChatFetch,
  ) {}

  static create({
    apiKey,
    fetch: send,
  }: {
    apiKey: string | undefined;
    fetch?: OpenAiChatFetch;
  }): HttpOpenAiChatChannel {
    return new HttpOpenAiChatChannel(apiKey, send ?? ((url, init) => fetch(url, init)));
  }

  async complete({
    model,
    messages,
  }: {
    model: string;
    messages: readonly ChatMessage[];
  }): Promise<ChatCompletion> {
    if (!this.apiKey) throw new Error("The platform OpenAI key is not configured");
    const response = await this.send(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenAI chat completion answered ${response.status}`);
    const completion = completionResponseSchema.parse(await response.json());
    return {
      model: completion.model,
      createdSeconds: completion.created,
      content: completion.choices[0]?.message.content ?? null,
      promptTokens: completion.usage.prompt_tokens,
      completionTokens: completion.usage.completion_tokens,
    };
  }
}
