import type { ApiKeyApi } from "@langwatch/api-key-contract";
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

/** `authToken` is null when no ingest key could be minted; the turns then post nothing. */
type Conversation = Readonly<{ authToken: string | null; threadId: string; userId: string }>;

/** All the demo key may do: record traces (Alex 2026-10-10 HOTEL-BOT-KEY). */
const HOTEL_BOT_KEY_PERMISSIONS = ["traces:create"];

type TurnTrace = Readonly<{
  completion: ChatCompletion;
  input: string;
  restaurantReviews?: readonly string[];
}>;

/** Main's `/api/demo/hotel_bot`: a scripted concierge whose chats land in the caller's project. */
export class HotelBotService {
  readonly #chat: OpenAiChatChannel;
  readonly #collector: TraceCollectorChannel;
  readonly #apiKeys: Pick<ApiKeyApi, "mintRunKey">;
  readonly #logger: Logger;
  readonly #random: () => number;
  readonly #nowMs: () => number;

  private constructor(deps: Parameters<typeof HotelBotService.create>[0]) {
    this.#chat = deps.chat;
    this.#collector = deps.collector;
    this.#apiKeys = deps.apiKeys;
    this.#logger = deps.logger;
    this.#random = deps.random;
    this.#nowMs = deps.nowMs;
  }

  static create(deps: {
    chat: OpenAiChatChannel;
    collector: TraceCollectorChannel;
    apiKeys: Pick<ApiKeyApi, "mintRunKey">;
    logger: Logger;
    random: () => number;
    nowMs: () => number;
  }): HotelBotService {
    return new HotelBotService(deps);
  }

  async run(input: HotelBotRunInput): Promise<HotelBotReply> {
    if (hotelBotDeclines(this.#random())) throw new HotelBotDeclinedError();

    const conversation = {
      authToken: await this.#ingestKey(input),
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

  /**
   * A short-lived key for this project, traces only, default life, capped by the starting key
   * (ARCHITECTURE.md §8, a key-started run carries that key's principal).
   */
  async #ingestKey({
    projectId,
    startedByApiKeyId,
    startedByUserId,
  }: HotelBotRunInput): Promise<string | null> {
    try {
      return await this.#apiKeys.mintRunKey({
        userId: startedByUserId,
        ...(startedByApiKeyId ? { callerApiKeyId: startedByApiKeyId } : {}),
        projectId,
        permissions: HOTEL_BOT_KEY_PERMISSIONS,
      });
    } catch (error) {
      this.#logger.warn({ error }, "hotel bot ingest key was not minted; no trace will be sent");
      return null;
    }
  }

  #complete(messages: readonly ChatMessage[]): Promise<ChatCompletion> {
    return this.#chat.complete({ model: HOTEL_BOT_MODEL, messages });
  }

  /** Main ignored a failed post: the demo answers alike whether the collector took the trace. */
  async #sendTrace(conversation: Conversation, turn: TurnTrace): Promise<void> {
    const { authToken } = conversation;
    if (!authToken) return;
    try {
      await this.#collector.post({
        authToken,
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
