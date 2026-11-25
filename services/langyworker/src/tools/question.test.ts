import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANSWERED_CONTINUE_LINE,
  askQuestions,
  dropRepeatedOptions,
  NO_ANSWER_PUSHBACK,
  QUESTION_TOOL_NAME,
  WAIT_MAX_MS,
  createQuestionExtension,
  renderAnswers,
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
      expect(Object.keys(questions.items.properties).toSorted()).toEqual([
        "allowOther",
        "bare",
        "header",
        "multiple",
        "options",
        "question",
      ]);
      const options = questions.items.properties.options as {
        items: { properties: Record<string, unknown> };
      };
      expect(Object.keys(options.items.properties).toSorted()).toEqual([
        "description",
        "label",
        "quiet",
      ]);
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

    /** @scenario "The tool result carries the go" */
    it("tells the model, after the answer, to continue the work in this turn", async () => {
      fakeApp({
        "/api/langy/waits": [{ waitId: "wait_6" }],
        "/api/langy/waits/wait_6": [
          {
            waitId: "wait_6",
            state: "answered",
            answers: [
              {
                question:
                  "Now that your agent is integrated, I think we should write some tests for it.",
                selected: ['Create "Guest completes checkout" as your first scenario test'],
              },
            ],
          },
        ],
      });

      const text = textOf(
        await questionTool().execute("t6", {
          questions: [
            {
              question:
                "Now that your agent is integrated, I think we should write some tests for it.",
              bare: true,
              options: [
                { label: 'Create "Guest completes checkout" as your first scenario test' },
                { label: "Chat about this", quiet: true },
              ],
            },
          ],
        }),
      );

      expect(text).toBe(
        [
          "Q: Now that your agent is integrated, I think we should write some tests for it.",
          'A: Create "Guest completes checkout" as your first scenario test',
          "",
          ANSWERED_CONTINUE_LINE,
        ].join("\n"),
      );
      expect(ANSWERED_CONTINUE_LINE).toBe(
        "The user has answered. Continue with the work that follows this answer in this turn.",
      );
    });

    /** @scenario "The tool result carries the go" */
    it("renders the go once, after every answer, and never on an empty answer set", () => {
      expect(
        renderAnswers([
          { question: "Which one?", selected: ["a"] },
          { question: "And this?", selected: [], other: "b" },
        ]),
      ).toBe(
        `Q: Which one?\nA: a\n\nQ: And this?\nA: in their own words: b\n\n${ANSWERED_CONTINUE_LINE}`,
      );
      expect(renderAnswers([])).toBe(NO_ANSWER_PUSHBACK);
      expect(NO_ANSWER_PUSHBACK).not.toContain(ANSWERED_CONTINUE_LINE);
    });
  });

  describe("when the question text repeats the options at its end", () => {
    const LABELS = [
      'Create "Guest completes checkout" as your first scenario test',
      "Chat about this",
    ];
    const PROPOSAL =
      "Now that your agent is integrated, I think we should write some tests for it. The first one I'd write is Guest completes checkout, because it covers the full happy path.";

    /** @scenario "The question text does not repeat the options the card draws" */
    it("drops a numbered, bulleted or bare list of the labels, and the line that introduced it", () => {
      const numbered = `${PROPOSAL}\n\nOptions, in this order:\n\n1. Create "Guest completes checkout" as your first scenario test\n2. "Chat about this"`;
      expect(dropRepeatedOptions(numbered, LABELS)).toBe(PROPOSAL);
      const bulleted = `${PROPOSAL}\n- Create "Guest completes checkout" as your first scenario test.\n* Chat about this\n`;
      expect(dropRepeatedOptions(bulleted, LABELS)).toBe(PROPOSAL);
      const bare = `${PROPOSAL}\n\nCreate "Guest completes checkout" as your first scenario test\nchat about this`;
      expect(dropRepeatedOptions(bare, LABELS)).toBe(PROPOSAL);
      // One label at the end is a repeat too; a line that is no label ends the list.
      expect(dropRepeatedOptions(`${PROPOSAL}\nChat about this`, LABELS)).toBe(PROPOSAL);
      expect(
        dropRepeatedOptions(`${PROPOSAL}\nOptions:\nChat about this\nOr tell me more.`, LABELS),
      ).toBe(`${PROPOSAL}\nOptions:\nChat about this\nOr tell me more.`);
    });

    /** @scenario "The question text does not repeat the options the card draws" */
    it("leaves a text with no repeat, one with the labels mid-text, and one that is only the labels alone", () => {
      expect(dropRepeatedOptions(PROPOSAL, LABELS)).toBe(PROPOSAL);
      const midText = `1. Create "Guest completes checkout" as your first scenario test\n2. Chat about this\n\n${PROPOSAL}`;
      expect(dropRepeatedOptions(midText, LABELS)).toBe(midText);
      expect(dropRepeatedOptions("1. Chat about this", LABELS)).toBe("1. Chat about this");
      expect(dropRepeatedOptions(`${PROPOSAL}\nChat about this`, [])).toBe(
        `${PROPOSAL}\nChat about this`,
      );
    });

    /** @scenario "The question text does not repeat the options the card draws" */
    it("raises the card with the trimmed text and the options as they were", async () => {
      const { calls } = fakeApp({
        "/api/langy/waits": [{ waitId: "wait_1" }],
        "/api/langy/waits/wait_1": [
          {
            waitId: "wait_1",
            state: "answered",
            answers: [{ question: PROPOSAL, selected: [LABELS[0]!] }],
          },
        ],
      });
      const options = [
        { label: LABELS[0]!, description: "Make the first end-to-end scenario now." },
        { label: LABELS[1]!, quiet: true, description: "Describe the scenario instead." },
      ];
      await questionTool().execute("t1", {
        questions: [
          {
            bare: true,
            header: "Propose the first scenario",
            question: `${PROPOSAL}\n\nOptions, in this order:\n\n1. ${LABELS[0]}\n2. "${LABELS[1]}"`,
            options,
          },
        ],
      });
      expect(calls[0]?.body).toMatchObject({
        kind: "question",
        questions: [
          { bare: true, header: "Propose the first scenario", question: PROPOSAL, options },
        ],
      });
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
      expect(text).not.toContain(ANSWERED_CONTINUE_LINE);
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
