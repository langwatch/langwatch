import { HandledError } from "@langwatch/handled-error";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryOpenAiChatChannel } from "../../channels/memory/memory.openai-chat.channel.ts";
import { MemoryTraceCollectorChannel } from "../../channels/memory/memory.trace-collector.channel.ts";
import { HOTEL_BOT_MODEL } from "../../rules/hotel-bot.rules.ts";
import { HotelBotService } from "../hotel-bot.service.ts";

const NOW_MS = 1_700_000_005_000;
const AUTH_TOKEN = "sk-lw-project-key";

/** Answers the draws in order and refuses an unscripted one, so every roll a run takes is named. */
function scriptedRandom(draws: readonly number[]): () => number {
  let next = 0;
  return () => {
    const draw = draws[next];
    if (draw === undefined) throw new Error(`unscripted random draw #${next + 1}`);
    next += 1;
    return draw;
  };
}

function setup(draws: readonly number[]) {
  const chat = MemoryOpenAiChatChannel.create();
  const collector = MemoryTraceCollectorChannel.create();
  const { logger, lines } = createTestLogger();
  const service = HotelBotService.create({
    chat,
    collector,
    logger,
    random: scriptedRandom(draws),
    nowMs: () => NOW_MS,
  });
  return { chat, collector, lines, service };
}

const ODD = 0.1;
const EVEN = 0.2;
const CONCIERGE_DRAWS = [ODD, ODD, 0.5, 0.4, 0.5, 0.6, 0.7];
const RESTAURANT_DRAWS = [ODD, EVEN, 0.99, 0.4, 0.5];

describe("HotelBotService", () => {
  describe("given no project key", () => {
    /** @scenario "A call without a project key is refused before any model call" */
    it("refuses as missing credentials and asks the model nothing", async () => {
      const { chat, service } = setup([]);

      await expect(service.run({})).rejects.toMatchObject({ code: "missing_credentials" });
      expect(chat.calls).toEqual([]);
    });
  });

  describe("given an even first roll", () => {
    /** @scenario "The bot turns away an even first roll without calling the model" */
    it("declines and asks the model nothing", async () => {
      const { chat, collector, service } = setup([EVEN]);

      await expect(service.run({ authToken: AUTH_TOKEN })).rejects.toMatchObject({
        code: "demo_bot_declined",
        httpStatus: 401,
      });
      expect(chat.calls).toEqual([]);
      expect(collector.posts).toEqual([]);
    });
  });

  describe("given an odd second roll", () => {
    /** @scenario "The concierge chat posts two turns to the caller's project" */
    it("runs the two-turn concierge chat and posts each turn", async () => {
      const { chat, collector, service } = setup(CONCIERGE_DRAWS);

      const reply = await service.run({ authToken: AUTH_TOKEN });

      expect(reply).toEqual({ message: "Sent to LangWatch" });
      expect(chat.calls).toHaveLength(4);
      expect(chat.calls.every((call) => call.model === HOTEL_BOT_MODEL)).toBe(true);
      expect(chat.calls[0]?.messages[1]?.content).toContain("Special Requests");
      expect(collector.posts.map((post) => post.authToken)).toEqual([AUTH_TOKEN, AUTH_TOKEN]);
      expect(collector.posts[0]?.trace).toMatchObject({
        spans: [
          {
            type: "llm",
            vendor: "openai",
            model: HOTEL_BOT_MODEL,
            input: { type: "chat_messages", value: [{ role: "user", content: "reply 1" }] },
            output: { type: "chat_messages", value: [{ role: "assistant", content: "reply 2" }] },
            timestamps: { started_at: 1_700_000_000_000, finished_at: NOW_MS },
          },
        ],
        metadata: { labels: [] },
      });
      expect(collector.posts[1]?.trace).toMatchObject({
        spans: [{ input: { value: [{ content: "reply 3" }] } }],
      });
    });

    it("keeps both turns in one thread", async () => {
      const { collector, service } = setup(CONCIERGE_DRAWS);

      await service.run({ authToken: AUTH_TOKEN });

      const [first, second] = collector.posts.map((post) => post.trace.metadata);
      expect(first).toEqual(second);
    });
  });

  describe("given an even second roll", () => {
    /** @scenario "The restaurant search posts one trace with its retrieved reviews" */
    it("runs the restaurant search and returns its reply", async () => {
      const { chat, collector, service } = setup(RESTAURANT_DRAWS);

      const reply = await service.run({ authToken: AUTH_TOKEN });

      expect(reply).toEqual({ message: "Sent to LangWatch", ragResponse: "reply 1" });
      expect(chat.calls).toHaveLength(1 + 6);
      expect(collector.posts).toHaveLength(1);
      expect(collector.posts[0]?.trace).toMatchObject({
        spans: [
          {
            name: "RestaurantAPI",
            type: "rag",
            contexts: [
              { content: "reply 2" },
              { content: "reply 3" },
              { content: "reply 4" },
              { content: "reply 5" },
              { content: "reply 6" },
              { content: "reply 7" },
            ],
          },
          { type: "llm", output: { value: [{ content: "reply 1" }] } },
        ],
        metadata: { labels: ["Restaurant API"] },
      });
    });
  });

  describe("given the collector cannot be reached", () => {
    /** @scenario "An unreachable collector still answers that the traces were sent" */
    it("answers that the traces were sent and warns", async () => {
      const { collector, lines, service } = setup(CONCIERGE_DRAWS);
      collector.unreachable = true;

      const reply = await service.run({ authToken: AUTH_TOKEN });

      expect(reply).toEqual({ message: "Sent to LangWatch" });
      expect(lines.findLine("warn", "hotel bot trace was not collected")).toBeDefined();
    });
  });

  describe("given OpenAI refuses the completion", () => {
    /** @scenario "A failing model call fails the run as an unknown error" */
    it("fails with an unhandled error and posts nothing", async () => {
      const { chat, collector, service } = setup(CONCIERGE_DRAWS);
      chat.failing = true;

      const failure = await service.run({ authToken: AUTH_TOKEN }).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(Error);
      expect(HandledError.isHandled(failure)).toBe(false);
      expect(collector.posts).toEqual([]);
    });
  });
});
