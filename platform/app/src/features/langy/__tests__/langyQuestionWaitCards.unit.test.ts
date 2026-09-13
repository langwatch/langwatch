/**
 * A question card built from the WAIT, not from the transcript (ADR-129).
 *
 * A tab that adopted a running turn reads no live stream, and the `question`
 * tool part only reaches its message list when the turn ends. The card was
 * therefore off screen for the whole wait, while the composer asked the reader
 * to answer it, and then came back after the turn with both options empty
 * because the answer had gone to the wait rather than into the transcript.
 *
 * @see specs/langy/langy-choice-questions.feature
 */
import type { LangyTurnToolCall } from "@langwatch/langy";
import { describe, expect, it } from "vitest";

import {
  langyAnsweredOptionIds,
  langyQuestionCards,
} from "../logic/langyLocalWaits";
import {
  questionToolCallIdsIn,
  questionWaitCardParts,
} from "../logic/langyQuestionTool";

const QUESTIONS = [
  {
    question: "Should I run one live support turn?",
    options: [
      { label: "Run one live turn", description: "Uses the model once" },
      { label: "Skip the live turn", description: "Static checks only" },
    ],
  },
];

function toolCallWithWait(
  over: { status?: "pending" | "answered"; answers?: unknown } = {},
): LangyTurnToolCall {
  return {
    toolCallId: "call_q1",
    toolName: "question",
    status: "initiated",
    wait: {
      waitId: "lwait_1",
      kind: "question",
      status: over.status ?? "pending",
      expiresAt: 0,
      callId: null,
      summary: null,
      pattern: null,
      patterns: [],
      reason: null,
      timeoutSeconds: null,
      skipOffered: false,
      workspaceName: null,
      hostname: null,
      questions: QUESTIONS,
      decision: null,
      source: null,
      answers: over.answers ?? null,
      answeredBy: null,
      answeredAt: null,
    },
  } as unknown as LangyTurnToolCall;
}

describe("given a turn this tab adopted, so it reads no live stream", () => {
  describe("when the tool raises the question wait", () => {
    /** @scenario "A question renders in a tab that never watched the turn" */
    it("builds the card from the record alone, with the question and its options", () => {
      const cards = langyQuestionCards({
        toolCalls: [toolCallWithWait()],
      });

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        waitId: "lwait_1",
        toolCallId: "call_q1",
        status: "pending",
      });

      const parts = questionWaitCardParts({
        toolCallId: cards[0]!.toolCallId,
        questions: cards[0]!.questions,
      });

      expect(parts).toHaveLength(1);
      expect(parts[0]!.blockId).toBe("question:call_q1:0");
      const card = parts[0]!.card as {
        kind: string;
        question: string;
        options: { id: string; label: string }[];
      };
      expect(card.kind).toBe("choices");
      expect(card.question).toBe("Should I run one live support turn?");
      expect(card.options.map((option) => option.label)).toEqual([
        "Run one live turn",
        "Skip the live turn",
      ]);
    });

    it("stands down once the transcript carries the same tool call", () => {
      const messages = [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-question",
              state: "input-available",
              toolCallId: "call_q1",
              input: { questions: QUESTIONS },
            },
          ],
        },
      ];

      expect(questionToolCallIdsIn(messages).has("call_q1")).toBe(true);
    });
  });
});

describe("given a question wait that was answered somewhere else", () => {
  describe("when the card is read back", () => {
    /** @scenario "A settled question reads settled, with the option that was chosen" */
    it("names the option the answer holds, so the card locks on it", () => {
      const cards = langyQuestionCards({
        toolCalls: [
          toolCallWithWait({
            status: "answered",
            answers: [
              {
                question: "Should I run one live support turn?",
                selected: ["Run one live turn"],
              },
            ],
          }),
        ],
      });
      const parts = questionWaitCardParts({
        toolCallId: cards[0]!.toolCallId,
        questions: cards[0]!.questions,
      });
      const card = parts[0]!.card as {
        options: { id: string; label: string }[];
      };

      expect(cards[0]!.status).toBe("answered");
      expect(
        langyAnsweredOptionIds({
          answers: cards[0]!.answers,
          options: card.options,
        }),
      ).toEqual({ optionIds: ["opt-1"] });
    });

    it("carries the reader's own words when they typed one", () => {
      expect(
        langyAnsweredOptionIds({
          answers: [{ question: "q", selected: [], other: "neither, wait" }],
          options: [{ id: "opt-1", label: "Run one live turn" }],
        }),
      ).toEqual({ optionIds: [], otherText: "neither, wait" });
    });

    it("names nothing for a wait that ended with no answer at all", () => {
      expect(
        langyAnsweredOptionIds({
          answers: null,
          options: [{ id: "opt-1", label: "Run one live turn" }],
        }),
      ).toBeNull();
    });
  });
});
