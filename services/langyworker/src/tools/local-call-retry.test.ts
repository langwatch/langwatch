import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runLocalCall } from "./local-workspace.js";
import { createTurnContext } from "./turn-context.js";

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fake app answering each start POST from `starts`, and every poll as done. */
function fakeApp(starts: Answer[]) {
  const posted: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    const answer: Answer =
      init?.method === "POST"
        ? (posted.push(url), starts.shift() ?? { status: 500 })
        : { status: 200, body: { callId: "call_1", state: "done", ok: true, text: "done" } };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: answer.headers,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posted };
}

function run() {
  const turnContext = createTurnContext();
  turnContext.turnId = "turn_1";
  return runLocalCall({ tool: "local_read", params: { path: "a.txt" }, turnContext });
}

process.env.LANGWATCH_ENDPOINT = "http://app.test";
process.env.LANGWATCH_API_KEY = "sk-lw-session-key";
process.env.LANGY_CONVERSATION_ID = "langyconv_1";

beforeEach(() => {
  vi.useFakeTimers();
  // The centre of the jitter, so the backoff waits are exact.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A fake app that takes the start, then answers each poll from `polls`. */
function fakePolls(polls: Answer[]) {
  let polled = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { method?: string }) => {
      const answer: Answer =
        init?.method === "POST"
          ? { status: 200, body: { callId: "call_1" } }
          : (polled++, polls.shift() ?? { status: 500 });
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: answer.headers,
      });
    }),
  );
  return { polled: () => polled };
}

describe("polling a local call", () => {
  describe("when the app fails a poll for a transient reason", () => {
    /** @scenario "Reading a local call's state is retried on a transient failure" */
    it("asks again with a growing wait and reads the answer", async () => {
      const app = fakePolls([
        { status: 502 },
        { status: 429 },
        { status: 200, body: { callId: "call_1", state: "done", ok: true, text: "done" } },
      ]);
      const result = run();
      await vi.advanceTimersByTimeAsync(0);
      expect(app.polled()).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(app.polled()).toBe(2);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(app.polled()).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toBe("done");
    });

    it("gives up after five more polls", async () => {
      const app = fakePolls([]);
      const settled = run().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await settled).toBeInstanceOf(Error);
      expect(app.polled()).toBe(6);
    });
  });

  describe("when transient failures come before polls for a lost call", () => {
    it("keeps the lost call's own three polls", async () => {
      const app = fakePolls([
        { status: 502 },
        { status: 502 },
        { status: 502 },
        { status: 200, body: { callId: "call_1", state: "running" } },
        { status: 404 },
        { status: 404 },
        { status: 404 },
      ]);
      const settled = run().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await settled).toBeInstanceOf(Error);
      expect(app.polled()).toBe(7);
    });
  });
});

describe("starting a local call", () => {
  describe("when the app answers 429 or 503 before taking it", () => {
    /** @scenario "Starting a local call is retried only when the app says it did not take it" */
    it("asks again after the wait the app names, then runs the call once", async () => {
      const app = fakeApp([
        { status: 503 },
        { status: 429, headers: { "retry-after": "3" } },
        { status: 200, body: { callId: "call_1" } },
      ]);
      const result = run();
      await vi.advanceTimersByTimeAsync(0);
      expect(app.posted).toHaveLength(1);
      // The first wait is the backoff: one second.
      await vi.advanceTimersByTimeAsync(999);
      expect(app.posted).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(app.posted).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(app.posted).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(app.posted).toHaveLength(3);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toBe("done");
    });

    it("gives up after five more tries", async () => {
      const app = fakeApp(Array.from({ length: 10 }, () => ({ status: 503 })));
      const result = run();
      const settled = result.catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await settled).toBeInstanceOf(Error);
      expect(app.posted).toHaveLength(6);
    });

    it("gives up at once when the app names a wait longer than a minute", async () => {
      const app = fakeApp([
        { status: 429, headers: { "retry-after": "120" } },
        { status: 200, body: { callId: "call_1" } },
      ]);
      const settled = run().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await settled).toBeInstanceOf(Error);
      expect(app.posted).toHaveLength(1);
    });
  });

  describe("when the app answers 503 because no folder is connected", () => {
    it("fails on the first answer without asking again", async () => {
      const app = fakeApp([
        {
          status: 503,
          body: { error: { code: "langy_local_workspace_offline", message: "No local folder" } },
        },
        { status: 200, body: { callId: "call_1" } },
      ]);
      const settled = run().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await settled).toBeInstanceOf(Error);
      expect(app.posted).toHaveLength(1);
    });
  });

  describe("when the request may have reached the app", () => {
    it("does not send it again after a 500", async () => {
      const app = fakeApp([{ status: 500 }, { status: 200, body: { callId: "call_1" } }]);
      const settled = run().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await settled).toBeInstanceOf(Error);
      expect(app.posted).toHaveLength(1);
    });

    it("does not send it again after a network error", async () => {
      const posted: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          posted.push(url);
          throw new TypeError("fetch failed");
        }),
      );
      const settled = run().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await settled).toBeInstanceOf(Error);
      expect(posted).toHaveLength(1);
    });
  });
});
