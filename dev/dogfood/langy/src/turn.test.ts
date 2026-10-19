import { describe, expect, it } from "vitest";

import type { HttpAnswer, LangWatchHttp } from "./http.ts";
import { askLangy, latestUserText, textOf } from "./turn.ts";

type Sent = Parameters<LangWatchHttp["request"]>[0];

const fakeHttp = (answers: HttpAnswer[]): { http: LangWatchHttp; sent: Sent[] } => {
  const sent: Sent[] = [];
  const http: LangWatchHttp = {
    projectId: "p",
    request: async <T>(input: Sent) => {
      sent.push(input);
      const next = answers.shift();
      if (!next) throw new Error("no answer left");
      return next as HttpAnswer<T>;
    },
  };
  return { http, sent };
};

const settled = (text: string): HttpAnswer => ({
  status: 200,
  body: {
    conversationId: "scenario_thread1",
    turnId: "t1",
    status: "succeeded",
    reply: { role: "assistant", text },
  },
  text: "",
});

describe("latestUserText", () => {
  it("takes the newest user message of the new messages", () => {
    expect(
      latestUserText({
        newMessages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "hi" },
          { role: "user", content: "second" },
        ],
        messages: [],
      }),
    ).toBe("second");
  });

  it("falls back to the whole thread", () => {
    expect(latestUserText({ newMessages: [], messages: [{ role: "user", content: "only" }] })).toBe(
      "only",
    );
  });

  it("reads the text parts of a part list", () => {
    expect(
      textOf({
        message: {
          role: "user",
          content: [
            { type: "text", text: "a", idempotencyKey: "k1" },
            { type: "image" },
            { type: "text", text: "b" },
          ],
        },
      }),
    ).toBe("a b");
  });
});

describe("askLangy", () => {
  it("adopts the thread id as the Langy conversation and returns the reply", async () => {
    const { http, sent } = fakeHttp([settled("Here is your chart.")]);

    const reply = await askLangy({
      http,
      conversationId: "scenario_thread1",
      text: "Chart my traces",
      idempotencyKey: "k1",
    });

    expect(reply).toEqual({ text: "Here is your chart.", conversationId: "scenario_thread1" });
    expect(sent[0]).toMatchObject({
      method: "POST",
      path: "/api/langy/conversations/scenario_thread1/messages",
      headers: { Prefer: "wait=120" },
      body: { messages: [{ role: "user", content: "Chart my traces" }], adoptConversationId: true },
    });
  });

  it("waits again on the same turn when the first wait ends unsettled", async () => {
    const { http, sent } = fakeHttp([
      { status: 202, body: { conversationId: "c", turnId: "t1" }, text: "" },
      settled("done"),
    ]);

    const reply = await askLangy({
      http,
      conversationId: "scenario_thread1",
      text: "Build it",
      idempotencyKey: "k1",
    });

    expect(reply.text).toBe("done");
    const keys = sent.map((call) => (call.body as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("gives up once the turn budget is spent", async () => {
    let clock = 0;
    const { http } = fakeHttp([{ status: 202, body: {}, text: "pending" }]);

    const asking = askLangy({
      http,
      conversationId: "c-thread",
      text: "x",
      idempotencyKey: "k1",
      now: () => (clock += 280_000),
    });

    await expect(asking).rejects.toThrow(/did not settle/);
  });

  it("surfaces a failed turn with Langy's error", async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: {
          conversationId: "c",
          turnId: "t",
          status: "failed",
          error: { code: "x" },
          reply: null,
        },
        text: "",
      },
    ]);

    await expect(
      askLangy({ http, conversationId: "c-thread", text: "x", idempotencyKey: "k1" }),
    ).rejects.toThrow(/Langy turn failed/);
  });

  it("answers a GitHub-not-connected turn with the connect prompt", async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: {
          conversationId: "c",
          turnId: "t",
          status: "failed",
          error: JSON.stringify({ code: "langy_github_not_connected", kind: "langy_github_not_connected" }),
          reply: null,
        },
        text: "",
      },
    ]);

    const reply = await askLangy({ http, conversationId: "c-thread", text: "x", idempotencyKey: "k1" });

    expect(reply.text).toMatch(/Connect GitHub/);
    expect(reply.conversationId).toBe("c");
  });
});
