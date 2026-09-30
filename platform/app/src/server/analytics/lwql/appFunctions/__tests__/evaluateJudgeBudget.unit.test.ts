/**
 * The judge's text budget as hydration applies it: questions that leave no
 * budget are refused once, before anything is sent, and a conversation is
 * measured with the judge's own ratio rather than the renderer's looser one.
 *
 * @see ../hydration/evaluate.ts
 * @see specs/lwql/app-functions.feature
 */
import { describe, expect, it } from "vitest";

import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "~/server/app-layer/instant-evals/classifier/token-budget";
import {
  classifierAnswering,
  evalOverConversation,
  judged,
  support,
  THREAD,
} from "./evaluateFixtures";
import { hydrate, sourceOf, trace } from "./hydrateFixtures";

const { stateTokens, bytesPerInputToken } = INSTANT_EVAL_CLASSIFIER_LIMITS;

/** A thread whose bytes fit four a token but not the judge's denser ratio. */
function threadBetweenTheRulers() {
  // Well under stateTokens * 4 bytes, well over stateTokens * ratio bytes.
  const targetBytes = Math.floor(stateTokens * ((4 + bytesPerInputToken) / 2));
  const turn = "the agent replied at length. ".repeat(20);
  const turns = Math.ceil(targetBytes / (2 * turn.length));
  return sourceOf({
    threadTraces: Array.from({ length: turns }, (_, index) =>
      trace({
        traceId: `trace-${index}`,
        threadKey: THREAD,
        input: turn,
        output: turn,
        startedAt: 1_700_000_000_000 + index,
      }),
    ),
  });
}

describe("given eval questions that alone fill the judge's state", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "Questions that leave no room for text are refused before anything is judged" */
    it("refuses with instant_eval_questions_too_long and sends nothing", async () => {
      const classifier = classifierAnswering(() =>
        judged([{ questionId: "annoyed", probability: 0.9 }]),
      );

      const failure = await hydrate({
        calls: [
          evalOverConversation({
            column: "annoyed",
            options: ["x".repeat(stateTokens * 8)],
          }),
        ],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: THREAD }],
        traceSource: sourceOf({
          threadTraces: [
            trace({ traceId: "trace-1", threadKey: THREAD, input: "hello" }),
          ],
        }),
        instantEvals: support(classifier),
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "instant_eval_questions_too_long",
        httpStatus: 422,
        meta: { stateTokens },
      });
      expect(
        (failure as { meta: { questionTokens: number } }).meta.questionTokens,
      ).toBeGreaterThan(stateTokens);
      expect(classifier.requests).toHaveLength(0);
    });
  });
});

describe("given a conversation that fits four bytes a token but not the judge's ratio", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "A conversation over the judge's budget is measured with the judge's own ratio" */
    it("re-renders it under the judge's budget and reports the row truncated", async () => {
      const classifier = classifierAnswering(() =>
        judged([{ questionId: "annoyed", probability: 0.9 }]),
      );

      const result = await hydrate({
        calls: [
          evalOverConversation({
            column: "annoyed",
            options: ["The customer sounds annoyed"],
          }),
        ],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: THREAD }],
        traceSource: threadBetweenTheRulers(),
        instantEvals: support(classifier),
      });

      const sent = classifier.requests[0]?.text ?? "";
      expect(Buffer.byteLength(sent)).toBeLessThanOrEqual(
        stateTokens * bytesPerInputToken,
      );
      expect(sent).toMatch(/\d+ turns omitted to fit the token budget/);
      expect(result.valueTruncations).toEqual([
        expect.objectContaining({ column: "annoyed" }),
      ]);
    });
  });
});
