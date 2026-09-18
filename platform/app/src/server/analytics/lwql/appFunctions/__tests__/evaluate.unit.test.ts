/**
 * The judged half of hydration, against a classifier that records what it was
 * asked.
 *
 * The claims worth making here are about *grouping and cost*, not about the
 * judge: how many requests one statement costs, which questions travel
 * together, and what a cell holds when nothing answered. The judge's own
 * behaviour is the classifier suite's.
 *
 * @see ../hydration/evaluate.ts
 * @see specs/analytics/lwql-eval-functions.feature
 */
import { describe, expect, it } from "vitest";

import type {
  InstantEvalClassifier,
  InstantEvalClassifyRequest,
  InstantEvalJudgement,
  InstantEvalVerdict,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import { INSTANT_EVAL_PRICING } from "~/server/app-layer/instant-evals/classifier/pricing";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "~/server/app-layer/instant-evals/classifier/token-budget";
import type { InstantEvalHydrationSupport } from "../hydration/contract";
import type { LangWatchQLAppFunctionCall } from "../plan";
import { hydrate, sourceOf, trace } from "./hydrateFixtures";

const THREAD = "conversation-1";

/** A classifier that records its requests and answers from a fixed table. */
function classifierAnswering(
  answer: (request: InstantEvalClassifyRequest) => InstantEvalJudgement,
): InstantEvalClassifier & { requests: InstantEvalClassifyRequest[] } {
  const requests: InstantEvalClassifyRequest[] = [];
  return {
    requests,
    limits: INSTANT_EVAL_CLASSIFIER_LIMITS,
    pricing: INSTANT_EVAL_PRICING,
    async classify(request) {
      requests.push(request);
      return answer(request);
    },
  };
}

function judged(verdicts: InstantEvalVerdict[]): InstantEvalJudgement {
  return { verdicts, inputTokens: 100, isTextTruncated: false };
}

function support(
  classifier: InstantEvalClassifier,
): InstantEvalHydrationSupport {
  return { classifier, maxConcurrency: 4, queryTokenBudget: 4_000_000 };
}

const evalOverConversation = (
  column: string,
  options: LangWatchQLAppFunctionCall["options"],
  fn = "eval",
): LangWatchQLAppFunctionCall => ({
  column,
  function: fn,
  options,
  source: { function: "conversation", options: [] },
});

const threadSource = () =>
  sourceOf({
    threadTraces: [
      trace({
        traceId: "trace-1",
        threadKey: THREAD,
        input: "my order never arrived",
        output: "I am sorry about that",
      }),
    ],
  });

describe("given one eval over an extracted conversation", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "The judged column carries the probability, not the conversation key" */
    it("puts the probability in the column and re-declares its type", async () => {
      const classifier = classifierAnswering(() =>
        judged([{ questionId: "annoyed", probability: 0.9 }]),
      );

      const result = await hydrate({
        calls: [
          evalOverConversation("annoyed", ["The customer sounds annoyed"]),
        ],
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
        rows: [{ annoyed: THREAD }],
        traceSource: threadSource(),
        instantEvals: support(classifier),
      });

      expect(result.rows).toEqual([{ annoyed: 0.9 }]);
      expect(result.columns).toEqual([
        { name: "annoyed", type: "Nullable(Float64)" },
      ]);
      expect(classifier.requests[0]?.text).toContain("my order never arrived");
    });
  });
});

describe("given three questions over the same conversation expression", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "Three questions over one text cost one classifier request per row" */
    it("asks once, carrying every question, and fills each column", async () => {
      const classifier = classifierAnswering(() =>
        judged([
          { questionId: "annoyed", probability: 0.8 },
          { questionId: "satisfaction", score: 2.5 },
          { questionId: "intent", label: "refund" },
        ]),
      );

      const result = await hydrate({
        calls: [
          evalOverConversation("annoyed", ["Annoyed"]),
          evalOverConversation(
            "satisfaction",
            ["How satisfied", 1, 5],
            "eval_score",
          ),
          evalOverConversation(
            "intent",
            ["What is asked for", ["refund: money back", "bug: broken"]],
            "eval_category",
          ),
        ],
        columns: [
          { name: "annoyed", type: "Nullable(String)" },
          { name: "satisfaction", type: "Nullable(String)" },
          { name: "intent", type: "Nullable(String)" },
        ],
        rows: [{ annoyed: THREAD, satisfaction: THREAD, intent: THREAD }],
        traceSource: threadSource(),
        instantEvals: support(classifier),
      });

      expect(classifier.requests).toHaveLength(1);
      expect(classifier.requests[0]?.questions.map((q) => q.id)).toEqual([
        "annoyed",
        "satisfaction",
        "intent",
      ]);
      expect(result.rows).toEqual([
        { annoyed: 0.8, satisfaction: 2.5, intent: "refund" },
      ]);
    });
  });
});

describe("given two evals over two different expressions", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "Two different texts in one statement are two requests per row" */
    it("asks once per text rather than once per statement", async () => {
      const classifier = classifierAnswering((request) =>
        judged(
          request.questions.map((question) => ({
            questionId: question.id,
            probability: 0.5,
          })),
        ),
      );

      await hydrate({
        calls: [
          evalOverConversation("whole", ["Annoyed"]),
          {
            column: "bounded",
            function: "eval",
            options: ["Annoyed"],
            source: { function: "conversation_bounded", options: [50, ""] },
          },
        ],
        columns: [
          { name: "whole", type: "Nullable(String)" },
          { name: "bounded", type: "Nullable(String)" },
        ],
        rows: [{ whole: THREAD, bounded: THREAD }],
        traceSource: threadSource(),
        instantEvals: support(classifier),
      });

      expect(classifier.requests).toHaveLength(2);
    });
  });
});

describe("given an eval over a plain column", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "An eval over a plain column needs no extraction read" */
    it("judges the column's own text and reads no trace", async () => {
      const classifier = classifierAnswering(() =>
        judged([{ questionId: "apology", probability: 0.2 }]),
      );
      const traceSource = sourceOf();

      const result = await hydrate({
        calls: [
          { column: "apology", function: "eval", options: ["An apology"] },
        ],
        columns: [{ name: "apology", type: "Nullable(String)" }],
        rows: [{ apology: "we are sorry for the delay" }],
        traceSource,
        instantEvals: support(classifier),
      });

      expect(classifier.requests[0]?.text).toBe("we are sorry for the delay");
      expect(traceSource.askedTraceIds).toEqual([[]]);
      expect(result.rows).toEqual([{ apology: 0.2 }]);
    });
  });
});

describe("given one verdict read four different ways", () => {
  describe("when every eval function is hydrated", () => {
    /** @scenario "Each eval function reports the answer its kind names" */
    it("reads the probability, the threshold, the mean and the label", async () => {
      const classifier = classifierAnswering(() =>
        judged([
          { questionId: "probability", probability: 0.8 },
          { questionId: "over", probability: 0.8 },
          { questionId: "under", probability: 0.8 },
          { questionId: "score", score: 3.25 },
          { questionId: "label", label: "refund" },
          {
            questionId: "distribution",
            label: "refund",
            probabilities: { refund: 0.7, bug: 0.3 },
          },
        ]),
      );
      const options = [
        "What is asked for",
        ["refund: money back", "bug: broken"],
      ];

      const result = await hydrate({
        calls: [
          evalOverConversation("probability", ["Annoyed"]),
          evalOverConversation("over", ["Annoyed", 0.7], "eval_passed"),
          evalOverConversation("under", ["Annoyed", 0.9], "eval_passed"),
          evalOverConversation("score", ["How satisfied", 1, 5], "eval_score"),
          evalOverConversation("label", options, "eval_category"),
          evalOverConversation("distribution", options, "eval_category_probs"),
        ],
        columns: [
          { name: "probability", type: "Nullable(String)" },
          { name: "over", type: "Nullable(String)" },
          { name: "under", type: "Nullable(String)" },
          { name: "score", type: "Nullable(String)" },
          { name: "label", type: "Nullable(String)" },
          { name: "distribution", type: "Nullable(String)" },
        ],
        rows: [
          {
            probability: THREAD,
            over: THREAD,
            under: THREAD,
            score: THREAD,
            label: THREAD,
            distribution: THREAD,
          },
        ],
        traceSource: threadSource(),
        instantEvals: support(classifier),
      });

      expect(result.rows[0]).toEqual({
        probability: 0.8,
        over: 1,
        under: 0,
        score: 3.25,
        label: "refund",
        distribution: JSON.stringify({ refund: 0.7, bug: 0.3 }),
      });
    });
  });
});

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
        calls: [evalOverConversation("annoyed", ["Annoyed"])],
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
