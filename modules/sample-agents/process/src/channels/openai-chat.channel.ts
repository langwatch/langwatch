export type ChatMessage = Readonly<{ role: "system" | "user" | "assistant"; content: string }>;

/** What the hotel bot reads back from one completion. */
export type ChatCompletion = Readonly<{
  model: string;
  createdSeconds: number;
  content: string | null;
  promptTokens: number;
  completionTokens: number;
}>;

/** OpenAI's chat completions, spent on the platform's own key. A failed call throws. */
export interface OpenAiChatChannel {
  complete(input: { model: string; messages: readonly ChatMessage[] }): Promise<ChatCompletion>;
}
