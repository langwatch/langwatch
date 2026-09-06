import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  askQuestions,
  NO_ANSWER_PUSHBACK,
  QUESTION_TOOL_NAME,
  WAIT_MAX_MS,
  createQuestionExtension,
} from "./question.js";
import { createTurnContext, type TurnContext } from "./turn-context.js";

type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: { properties: Record<string, unknown> };
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: { type: string; text: string }[] }>;
};

/** The holder as the runner leaves it while a turn runs. */
function turnInFlight(turnId = "turn_1"): TurnContext {
  const context = createTurnContext();
  context.turnId = turnId;
  return context;
}

function questionTool(turnContext: TurnContext = turnInFlight()): RegisteredTool {
  let registered: RegisteredTool | undefined;
  const pi = {
    registerTool: (tool: RegisteredTool) => {
      registered = tool;
    },
    on: () => undefined,
  };
  const extension = createQuestionExtension({ turnContext }) as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  return registered!;
}

function textOf(result: { content: { type: string; text: string }[] }): string {
  return result.content.map((part) => part.text).join("");
}

function fakeApp(routes: Record<string, unknown[]>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const queue = routes[path];
      if (!queue || queue.length === 0) throw new Error(`no fake answer for ${path}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const body = queue.length === 1 ? queue[0] : queue.shift();
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );
  return { calls };
}

process.env.LANGWATCH_ENDPOINT = "http://app.test";
process.env.LANGWATCH_API_KEY = "sk-lw-session-key";
process.env.LANGY_CONVERSATION_ID = "langyconv_1";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the question tool", () => {
  describe("given the extension is registered", () => {
    /** @scenario "The worker has a question tool" */
    it("takes questions with a header, options and the multiple flag", () => {
      const tool = questionTool();

      expect(tool.name).toBe(QUESTION_TOOL_NAME);
      const questions = tool.parameters.properties.questions as {
        items: { properties: Record<string, { properties?: Record<string, unknown> }> };
      };
      expect(Object.keys(questions.items.properties).sort()).toEqual([
        "allowOther",
        "header",
        "multiple",
        "options",
        "question",
      ]);
      const options = questions.items.properties.options as {
        items: { properties: Record<string, unknown> };
      };
      expect(Object.keys(options.items.properties).sort()).toEqual(["description", "label"]);
      expect(tool.description).toContain("Decide routine things alone");
      expect(tool.description).toContain("differ for the user");
    });
  });

  describe("when the user picks an option", () => {
    /** @scenario "Selecting an option returns it to the tool and the turn continues" */
    it("returns the answer as the tool result", async () => {
      const { calls } = fakeApp({
        "/api/langy/waits": [{ waitId: "wait_1" }],
        "/api/langy/waits/wait_1": [
          { waitId: "wait_1", state: "pending" },
          {
            waitId: "wait_1",
            state: "answered",
            answers: [
              { question: "Which file owns the tracing setup?", selected: ["src/index.ts"] },
            ],
          },
        ],
      });

      const text = textOf(
        await questionTool().execute("t1", {
          questions: [
            {
              question: "Which file owns the tracing setup?",
              options: [{ label: "src/index.ts" }, { label: "src/server.ts" }],
            },
          ],
        }),
      );

      expect(calls[0]?.url).toBe("http://app.test/api/langy/waits");
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.body).toMatchObject({
        kind: "question",
        conversationId: "langyconv_1",
        turnId: "turn_1",
      });
      expect(text).toContain("Q: Which file owns the tracing setup?");
      expect(text).toContain("A: src/index.ts");
    });
  });

  describe("when the user writes their own answer", () => {
    /** @scenario "A free-text answer reaches the tool as words" */
    it("returns their words", async () => {
      fakeApp({
        "/api/langy/waits": [{ waitId: "wait_2" }],
        "/api/langy/waits/wait_2": [
          {
            waitId: "wait_2",
            state: "answered",
            answers: [
              {
                question: "Which account should open the pull request?",
                selected: [],
                other: "the acme-bot account",
              },
            ],
          },
        ],
      });

      const text = textOf(
        await questionTool().execute("t2", {
          questions: [
            {
              question: "Which account should open the pull request?",
              options: [{ label: "mine" }],
              allowOther: true,
            },
          ],
        }),
      );

      expect(text).toContain("the acme-bot account");
    });
  });

  describe("when nobody answers", () => {
    /** @scenario "A question no one answers ends the turn in words" */
    it("tells the model to end its turn and say what it waits for", async () => {
      fakeApp({
        "/api/langy/waits": [{ waitId: "wait_3" }],
        "/api/langy/waits/wait_3": [{ waitId: "wait_3", state: "expired" }],
      });

      const text = textOf(
        await questionTool().execute("t3", {
          questions: [{ question: "Which file?", options: [{ label: "a" }] }],
        }),
      );

      expect(text).toBe(NO_ANSWER_PUSHBACK);
      expect(text).toContain("End your turn");
    });
  });

  describe("when the app never settles the card", () => {
    /** @scenario "A question no one answers ends the turn in words" */
    it("stops waiting at the ten minutes the card on screen waits", async () => {
      const { calls } = fakeApp({
        "/api/langy/waits": [{ waitId: "wait_5" }],
        "/api/langy/waits/wait_5": [{ waitId: "wait_5", state: "pending" }],
      });
      expect(WAIT_MAX_MS).toBe(10 * 60 * 1000);

      let clock = 1_700_000_000_000;
      const text = await askQuestions({
        questions: [{ question: "Which file?", options: [{ label: "a" }] }],
        turnContext: turnInFlight(),
        now: () => {
          clock += 60_000;
          return clock;
        },
      });

      expect(text).toBe(NO_ANSWER_PUSHBACK);
      const polls = calls.filter((call) => call.method === "GET").length;
      expect(polls).toBeLessThanOrEqual(WAIT_MAX_MS / 60_000 + 1);
    });
  });

  describe("when the turn is stopped", () => {
    /** @scenario "Stopping the turn closes the open question" */
    it("stops polling and reads cancelled", async () => {
      const { calls } = fakeApp({
        "/api/langy/waits": [{ waitId: "wait_4" }],
        "/api/langy/waits/wait_4": [{ waitId: "wait_4", state: "pending" }],
      });
      const controller = new AbortController();
      const asking = questionTool().execute(
        "t4",
        { questions: [{ question: "Which file?", options: [{ label: "a" }] }] },
        controller.signal,
      );
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(1));
      controller.abort();

      await expect(asking).rejects.toThrow("cancelled");
    });
  });
});
