import type modelPrices from "llm-cost/model_prices_and_context_window.json";
import type { OpenAI } from "openai";
import { type SnakeToCamelCaseNested } from "./helpers";
import {
  type BaseSpan as ServerBaseSpan,
  type ChatMessage as ServerChatMessage,
  type ChatRichContent as ServerChatRichContent,
  type LLMSpan as ServerLLMSpan,
  type RAGSpan as ServerRAGSpan,
  type SpanInputOutput as ServerSpanInputOutput,
  type TypedValueChatMessages,
  type Trace,
} from "./server/types/tracer";

export type Metadata = SnakeToCamelCaseNested<Trace["metadata"]>;

export type ChatMessage = ServerChatMessage;

export type ChatRichContent = ServerChatRichContent;

// Check to see if out ChatMessage type is compatible with OpenAIChatCompletion messages
// eslint-disable-next-line @typescript-eslint/no-unused-vars
({}) as OpenAI.Chat.ChatCompletionMessageParam satisfies ChatMessage;
// Check to see spans input/output is still compatible with OpenAIChatCompletion messages to avoid camelCase/snake_case issues
// eslint-disable-next-line @typescript-eslint/no-unused-vars
({}) as {
  type: "chat_messages";
  value: OpenAI.Chat.ChatCompletionMessageParam[];
} satisfies BaseSpan["input"];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
({}) as {
  type: "chat_messages";
  value: OpenAI.Chat.ChatCompletionMessageParam[];
}[] satisfies BaseSpan["outputs"];

// Keep the input/output types signatures as snake case to match the official openai nodejs api
export type SpanInputOutput =
  | SnakeToCamelCaseNested<
      Exclude<ServerSpanInputOutput, TypedValueChatMessages>
    >
  | (TypedValueChatMessages & { type: ChatMessage });

export type ConvertServerSpan<T extends ServerBaseSpan> =
  SnakeToCamelCaseNested<Omit<T, "input" | "outputs">> & {
    input?: SpanInputOutput | null;
    outputs: SpanInputOutput[];
  };

export type PendingSpan<T extends BaseSpan> = Omit<
  T,
  "traceId" | "timestamps"
> & {
  timestamps: Omit<T["timestamps"], "finishedAt"> & {
    finishedAt?: number | null;
  };
};

export type BaseSpan = ConvertServerSpan<ServerBaseSpan>;

export type PendingBaseSpan = PendingSpan<BaseSpan>;

// vendor is deprecated, and we try to force the available models here
export type LLMSpan = ConvertServerSpan<
  Omit<ServerLLMSpan, "vendor" | "model">
> & { model: keyof typeof modelPrices | (string & NonNullable<unknown>) };
export type PendingLLMSpan = PendingSpan<LLMSpan>;

export type RAGSpan = ConvertServerSpan<ServerRAGSpan>;
export type PendingRAGSpan = PendingSpan<RAGSpan>;
