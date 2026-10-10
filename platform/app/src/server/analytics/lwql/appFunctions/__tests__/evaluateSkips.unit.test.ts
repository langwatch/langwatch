/**
 * What a judged cell holds when the judge did not answer it.
 *
 * Four ways that happens, and they are not the same story: the classifier
 * declined with a reason, it failed outright, the key named no text to judge,
 * or the caller cancelled. Each has to reach the caller as what it was — a null
 * cell with the right diagnostic — because "null" alone sends someone to check
 * the wrong thing.
 *
 * @see ../hydration/evaluate.ts
 * @see specs/lwql/eval-functions.feature
 */
import { describe, expect, it } from "vitest";

import type { InstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier/classifier";
import { INSTANT_EVAL_PRICING } from "~/server/app-layer/instant-evals/classifier/pricing";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "~/server/app-layer/instant-evals/classifier/token-budget";

import {
  classifierAnswering,
  evalOverConversation,
  judged,
  support,
} from "./evaluateFixtures";
import { hydrate, sourceOf } from "./hydrateFixtures";

describe("given a classifier that skips one text and answers the rest", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "A row the classifier could not judge is skipped rather than guessed" */
    it("leaves that cell null and says how many texts went unjudged", async () => {
      const classifier = classifierAnswering((request) =>
        request.text.includes("second")
          ? {
              verdicts: [],
              skippedReason: "classifier_rate_limited",
              inputTokens: 0,
              isTextTruncated: false,
            }
          : judged([{ questionId: "annoyed", probability: 0.4 }]),
      );

      const result = await hydrate({
        calls: [{ column: "annoyed", function: "eval", options: ["Annoyed"] }],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: "the first one" }, { annoyed: "the second one" }],
        traceSource: sourceOf(),
        instantEvals: support(classifier),
      });

      expect(result.rows).toEqual([{ annoyed: 0.4 }, { annoyed: null }]);
      expect(result.evalUsage?.skipped).toEqual({ classifier_rate_limited: 1 });
      expect(result.evalUsage?.requests).toBe(2);
    });
  });
});

describe("given a key that resolves to no text at all", () => {
  describe("when the statement is hydrated", () => {
    it("leaves the cell null and reports the key as unresolved", async () => {
      const classifier = classifierAnswering(() => judged([]));

      const result = await hydrate({
        calls: [
          evalOverConversation({ column: "annoyed", options: ["Annoyed"] }),
        ],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: "conversation-that-does-not-exist" }],
        traceSource: sourceOf(),
        instantEvals: support(classifier),
      });

      expect(result.rows).toEqual([{ annoyed: null }]);
      expect(result.unresolvedKeys).toEqual([
        { column: "annoyed", function: "eval", keys: 1 },
      ]);
      expect(classifier.requests).toHaveLength(0);
    });
  });
});

describe("given a caller that cancels mid-query", () => {
  describe("when the statement is being judged", () => {
    /** @scenario "A cancelled query stops judging instead of paying out the rest" */
    it("stops sending and hands back what was judged, naming the rest", async () => {
      const controller = new AbortController();
      let asked = 0;
      const classifier = classifierAnswering(() => {
        asked += 1;
        controller.abort();
        return judged([{ questionId: "annoyed", probability: 0.5 }]);
      });

      const run = hydrate({
        calls: [{ column: "annoyed", function: "eval", options: ["Annoyed"] }],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [
          { annoyed: "one" },
          { annoyed: "two" },
          { annoyed: "three" },
          { annoyed: "four" },
        ],
        traceSource: sourceOf(),
        instantEvals: {
          classifier,
          maxConcurrency: 1,
          queryTokenBudget: 4_000_000,
        },
        signal: controller.signal,
      });

      const result = await run;
      // The first unit was in flight when the cancellation landed and its
      // answer is kept; the three behind it were never sent, and the result
      // says which rows they are so the service can fail the query as
      // cancelled after recording the one that was paid for.
      expect(asked).toBe(1);
      expect(result.rows[0]?.annoyed).toBe(0.5);
      expect(result.cancellation).toEqual({ unjudgedRows: [1, 2, 3] });
      expect(result.evalUsage).toMatchObject({ requests: 1 });
    });

    it("hands the classifier the signal, so a request in flight is dropped too", async () => {
      const controller = new AbortController();
      const seen: (AbortSignal | undefined)[] = [];
      const classifier: InstantEvalClassifier = {
        limits: INSTANT_EVAL_CLASSIFIER_LIMITS,
        pricing: INSTANT_EVAL_PRICING,
        async classify(_request, signal) {
          seen.push(signal);
          return judged([{ questionId: "annoyed", probability: 0.5 }]);
        },
      };

      await hydrate({
        calls: [{ column: "annoyed", function: "eval", options: ["Annoyed"] }],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: "one" }],
        traceSource: sourceOf(),
        instantEvals: {
          classifier,
          maxConcurrency: 1,
          queryTokenBudget: 4_000_000,
        },
        signal: controller.signal,
      });

      expect(seen).toEqual([controller.signal]);
    });
  });
});

describe("given a classifier that fails on one text and answers the rest", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "A text the classifier failed on is skipped, not reported as a missing key" */
    it("reports it as a skipped judgement rather than as an unresolved key", async () => {
      const classifier = classifierAnswering((request) => {
        if (request.text.includes("second")) {
          throw new Error("the classifier dropped this one");
        }
        return judged([{ questionId: "annoyed", probability: 0.4 }]);
      });

      const result = await hydrate({
        calls: [{ column: "annoyed", function: "eval", options: ["Annoyed"] }],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: "the first one" }, { annoyed: "the second one" }],
        traceSource: sourceOf(),
        instantEvals: support(classifier),
      });

      expect(result.rows).toEqual([{ annoyed: 0.4 }, { annoyed: null }]);
      // The reason matters: the key resolved and the text was sent, so
      // reporting it as a key that named nothing would send the caller to
      // check their conversation ids.
      expect(result.evalUsage?.skipped).toEqual({ classifier_failed: 1 });
      expect(result.unresolvedKeys).toEqual([]);
    });
  });
});
