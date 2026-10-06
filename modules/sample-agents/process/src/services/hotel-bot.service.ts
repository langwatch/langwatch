import { ProjectMissingCredentialsError } from "@langwatch/api";
import { generate } from "@langwatch/ksuid";
import type { Logger } from "@langwatch/observability";
import {
  HotelBotDeclinedError,
  type HotelBotReply,
  type HotelBotRunInput,
} from "@langwatch/sample-agents-contract";

import type {
  ChatCompletion,
  ChatMessage,
  OpenAiChatChannel,
} from "../channels/openai-chat.channel.ts";
import type { CollectorTrace, TraceCollectorChannel } from "../channels/trace-collector.channel.ts";
import {
  GUEST_REPLY_PROMPT,
  guestQueryFor,
  HOTEL_BOT_MODEL,
  HOTEL_SYSTEM_PROMPT,
  hotelBotDeclines,
  hotelBotRunsRestaurantSearch,
  initialGuestPrompt,
  RAG_SYSTEM_PROMPT,
  RAG_USER_INPUT,
  RESTAURANT_REVIEW_PROMPT,
  restaurantReviewCount,
} from "../rules/hotel-bot.rules.ts";

const TRACE_KSUID_RESOURCE = "trace";
const SPAN_KSUID_RESOURCE = "span";
const THREAD_KSUID_RESOURCE = "thread";
const USER_KSUID_RESOURCE = "user";

function mintId(resource: string): string {
  return generate(resource).toString();
}

type Conversation = Readonly<{ authToken: string; threadId: string; userId: string }>;

type TurnTrace = Readonly<{
  completion: ChatCompletion;
  input: string;
  restaurantReviews?: readonly string[];
}>;

/** Main's `/api/demo/hotel_bot`: a scripted concierge whose chats land in the caller's project. */
export class HotelBotService {
  readonly #chat: OpenAiChatChannel;
  readonly #collector: TraceCollectorChannel;
  readonly #logger: Logger;
  readonly #random: () => number;
  readonly #nowMs: () => number;

  private constructor(deps: Parameters<typeof HotelBotService.create>[0]) {
    this.#chat = deps.chat;
    this.#collector = deps.collector;
    this.#logger = deps.logger;
    this.#random = deps.random;
    this.#nowMs = deps.nowMs;
  }

  static create(deps: {
    chat: OpenAiChatChannel;
    collector: TraceCollectorChannel;
    logger: Logger;
    random: () => number;
    nowMs: () => number;
  }): HotelBotService {
    return new HotelBotService(deps);
  }

  async run({ authToken }: HotelBotRunInput): Promise<HotelBotReply> {
    if (!authToken) throw new ProjectMissingCredentialsError();
    if (hotelBotDeclines(this.#random())) throw new HotelBotDeclinedError();

    const conversation = {
      authToken,
      threadId: mintId(THREAD_KSUID_RESOURCE),
      userId: mintId(USER_KSUID_RESOURCE),
    };
    if (hotelBotRunsRestaurantSearch(this.#random())) {
      return {
        message: "Sent to LangWatch",
        ragResponse: await this.#restaurantSearch(conversation),
      };
    }
    await this.#conciergeChat(conversation);
    return { message: "Sent to LangWatch" };
  }

  async #restaurantSearch(conversation: Conversation): Promise<string | null> {
    const completion = await this.#complete([
      { role: "system", content: RAG_SYSTEM_PROMPT },
      { role: "user", content: RAG_USER_INPUT },
    ]);
    const reviews = await Promise.all(
      Array.from({ length: restaurantReviewCount(this.#random()) }, () =>
        this.#complete([{ role: "system", content: RESTAURANT_REVIEW_PROMPT }]),
      ),
    );
    await this.#sendTrace(conversation, {
      completion,
      input: RAG_USER_INPUT,
      restaurantReviews: reviews.map((review) => review.content ?? ""),
    });
    return completion.content;
  }

  async #conciergeChat(conversation: Conversation): Promise<void> {
    const opening = await this.#complete([
      { role: "system", content: HOTEL_SYSTEM_PROMPT },
      { role: "user", content: initialGuestPrompt(guestQueryFor(this.#random())) },
    ]);
    const guestInput = opening.content ?? "";

    const first = await this.#complete([
      { role: "system", content: HOTEL_SYSTEM_PROMPT },
      { role: "user", content: guestInput },
    ]);
    await this.#sendTrace(conversation, { completion: first, input: guestInput });
    const concierge = first.content ?? "";

    const guestReply =
      (
        await this.#complete([
          { role: "system", content: HOTEL_SYSTEM_PROMPT },
          { role: "user", content: guestInput },
          { role: "assistant", content: concierge },
          { role: "user", content: GUEST_REPLY_PROMPT },
        ])
      ).content ?? "";

    const second = await this.#complete([
      { role: "system", content: HOTEL_SYSTEM_PROMPT },
      { role: "user", content: guestInput },
      { role: "assistant", content: concierge },
      { role: "user", content: guestReply },
    ]);
    await this.#sendTrace(conversation, { completion: second, input: guestReply });
  }

  #complete(messages: readonly ChatMessage[]): Promise<ChatCompletion> {
    return this.#chat.complete({ model: HOTEL_BOT_MODEL, messages });
  }

  /** Main ignored a failed post: the demo answers alike whether the collector took the trace. */
  async #sendTrace(conversation: Conversation, turn: TurnTrace): Promise<void> {
    try {
      await this.#collector.post({
        authToken: conversation.authToken,
        trace: this.#collectorTrace(conversation, turn),
      });
    } catch (error) {
      this.#logger.warn({ error }, "hotel bot trace was not collected");
    }
  }

  #collectorTrace(
    { threadId, userId }: Conversation,
    { completion, input, restaurantReviews }: TurnTrace,
  ): CollectorTrace {
    const contentPrefixId = Math.round(this.#random());
    const ragTimeMs = Math.round(this.#random() * 300);
    const startedAt = completion.createdSeconds * 1000;
    const finishedAt = this.#nowMs();
    const ragSpan = restaurantReviews && {
      name: "RestaurantAPI",
      type: "rag",
      span_id: mintId(SPAN_KSUID_RESOURCE),
      input: { type: "text", value: input },
      contexts: restaurantReviews.map((content, index) => ({
        documentId: `doc_${contentPrefixId}_${index}`,
        content,
      })),
      timestamps: { started_at: startedAt - ragTimeMs, finished_at: startedAt },
    };
    const llmSpan = {
      type: "llm",
      span_id: mintId(SPAN_KSUID_RESOURCE),
      vendor: "openai",
      model: completion.model,
      input: { type: "chat_messages", value: [{ role: "user", content: input }] },
      output: {
        type: "chat_messages",
        value: [{ role: "assistant", content: completion.content }],
      },
      params: { temperature: 0.7, stream: false },
      metrics: {
        prompt_tokens: completion.promptTokens,
        completion_tokens: completion.completionTokens,
      },
      timestamps: { first_token_at: finishedAt, started_at: startedAt, finished_at: finishedAt },
    };
    return {
      trace_id: mintId(TRACE_KSUID_RESOURCE),
      spans: ragSpan ? [ragSpan, llmSpan] : [llmSpan],
      metadata: {
        thread_id: threadId,
        user_id: userId,
        labels: ragSpan ? ["Restaurant API"] : [],
      },
    };
  }
}
