/**
 * What happens to a conversation too long for the judge.
 *
 * `--target threads` writes `conversation(ConversationId)`, which carries no
 * budget of its own, so a long thread reaches hydration whole. The claim here
 * is about *which part survives*: the close of a conversation is what most
 * questions are about, so the cut goes through the bounded renderer rather
 * than the classifier's byte cut, and the row still reports itself truncated.
 *
 * @see ../hydration/evaluate.ts
 * @see specs/lwql/eval-functions.feature
 */
import { describe, expect, it } from "vitest";

import {
  classifierAnswering,
  evalOverConversation,
  judged,
  support,
  THREAD,
} from "./evaluateFixtures";
import { hydrate, sourceOf, trace } from "./hydrateFixtures";

const OPENING = "THE-OPENING-my order never arrived";
const CLOSING = "THE-CLOSING-this is the last thing anyone said";

/** A thread far past the judge's state cap, with both ends marked. */
function longThread() {
  const filler = "the agent replied at length. ".repeat(400);
  return sourceOf({
    threadTraces: [
      trace({
        traceId: "trace-open",
        threadKey: THREAD,
        input: OPENING,
        output: "I am sorry about that",
        startedAt: 1_700_000_000_000,
      }),
      ...Array.from({ length: 40 }, (_, index) =>
        trace({
          traceId: `trace-mid-${index}`,
          threadKey: THREAD,
          input: filler,
          output: filler,
          startedAt: 1_700_000_001_000 + index,
        }),
      ),
      trace({
        traceId: "trace-close",
        threadKey: THREAD,
        input: "and one more thing",
        output: CLOSING,
        startedAt: 1_700_000_900_000,
      }),
    ],
  });
}

describe("given a conversation longer than the judge takes", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "A conversation past the judge's budget is cut through the bounded renderer, keeping both ends" */
    it("keeps the end of the conversation and names the turns it dropped", async () => {
      const classifier = classifierAnswering(() =>
        judged([{ questionId: "annoyed", probability: 0.9 }]),
      );

      await hydrate({
        calls: [
          evalOverConversation("annoyed", ["The customer sounds annoyed"]),
        ],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: THREAD }],
        traceSource: longThread(),
        instantEvals: support(classifier),
      });

      const sent = classifier.requests[0]?.text ?? "";

      // The close survives, which is the whole point: a byte cut would have
      // kept the opening and dropped this.
      expect(sent).toContain(CLOSING);
      // Both ends, not just the end.
      expect(sent).toContain(OPENING);
      // And the reader is told what went missing from the middle, so a cut
      // conversation can never be mistaken for a short one.
      expect(sent).toMatch(/\d+ turns omitted to fit the token budget/);
    });

    /** @scenario "A conversation past the judge's budget is cut through the bounded renderer, keeping both ends" */
    it("marks the row truncated even though the classifier had nothing left to cut", async () => {
      const classifier = classifierAnswering(() =>
        judged([{ questionId: "annoyed", probability: 0.9 }]),
      );

      const result = await hydrate({
        calls: [
          evalOverConversation("annoyed", ["The customer sounds annoyed"]),
        ],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: THREAD }],
        traceSource: longThread(),
        instantEvals: support(classifier),
      });

      expect(result.valueTruncations).toEqual([
        expect.objectContaining({ column: "annoyed" }),
      ]);
    });

    /** @scenario "A conversation inside the judge's budget is sent whole and not marked truncated" */
    it("leaves a conversation inside the budget alone", async () => {
      const classifier = classifierAnswering(() =>
        judged([{ questionId: "annoyed", probability: 0.9 }]),
      );

      const result = await hydrate({
        calls: [
          evalOverConversation("annoyed", ["The customer sounds annoyed"]),
        ],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: THREAD }],
        traceSource: sourceOf({
          threadTraces: [
            trace({
              traceId: "trace-1",
              threadKey: THREAD,
              input: OPENING,
              output: CLOSING,
            }),
          ],
        }),
        instantEvals: support(classifier),
      });

      const sent = classifier.requests[0]?.text ?? "";
      expect(sent).toContain(OPENING);
      expect(sent).toContain(CLOSING);
      expect(sent).not.toMatch(/omitted to fit the token budget/);
      expect(result.valueTruncations).toEqual([]);
    });
  });
});
