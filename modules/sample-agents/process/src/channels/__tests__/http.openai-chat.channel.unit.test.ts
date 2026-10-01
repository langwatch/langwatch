import { describe, expect, it } from "vitest";

import { HttpOpenAiChatChannel, type OpenAiChatFetch } from "../http/http.openai-chat.channel.ts";

type SentRequest = Readonly<{ url: string; init: Parameters<OpenAiChatFetch>[1] }>;

function recordingFetch(response: () => Response): { fetch: OpenAiChatFetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({ url, init });
      return response();
    },
  };
}

function sentBody(request: SentRequest | undefined): unknown {
  const body = request?.init.body;
  if (typeof body !== "string") throw new Error("the channel sent no JSON body");
  return JSON.parse(body);
}

const COMPLETION = {
  model: "gpt-5-mini-2025-08-07",
  created: 1_700_000_000,
  choices: [{ message: { content: "Welcome to the hotel!" } }],
  usage: { prompt_tokens: 12, completion_tokens: 34 },
};

const MESSAGES = [{ role: "user", content: "Hello" }] as const;

describe("HttpOpenAiChatChannel", () => {
  /** @scenario "The OpenAI channel sends the platform key and the conversation" */
  it("posts the conversation with the key as a bearer token and reads the reply", async () => {
    const { fetch, sent } = recordingFetch(() => Response.json(COMPLETION));
    const channel = HttpOpenAiChatChannel.create({ apiKey: "sk-platform", fetch });

    const completion = await channel.complete({ model: "gpt-5-mini", messages: MESSAGES });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent[0]?.init.headers).toMatchObject({ Authorization: "Bearer sk-platform" });
    expect(sentBody(sent[0])).toEqual({
      model: "gpt-5-mini",
      messages: MESSAGES,
    });
    expect(completion).toEqual({
      model: "gpt-5-mini-2025-08-07",
      createdSeconds: 1_700_000_000,
      content: "Welcome to the hotel!",
      promptTokens: 12,
      completionTokens: 34,
    });
  });

  describe("given no platform key", () => {
    /** @scenario "The OpenAI channel sends nothing without a platform key" */
    it("fails without sending a request", async () => {
      const { fetch, sent } = recordingFetch(() => Response.json(COMPLETION));
      const channel = HttpOpenAiChatChannel.create({ apiKey: undefined, fetch });

      await expect(channel.complete({ model: "gpt-5-mini", messages: MESSAGES })).rejects.toThrow(
        "not configured",
      );
      expect(sent).toEqual([]);
    });
  });

  describe("given OpenAI answers an error status", () => {
    /** @scenario "The OpenAI channel fails on a refused completion" */
    it("fails", async () => {
      const { fetch } = recordingFetch(() => Response.json({ error: {} }, { status: 401 }));
      const channel = HttpOpenAiChatChannel.create({ apiKey: "sk-wrong", fetch });

      await expect(channel.complete({ model: "gpt-5-mini", messages: MESSAGES })).rejects.toThrow(
        "401",
      );
    });
  });
});
