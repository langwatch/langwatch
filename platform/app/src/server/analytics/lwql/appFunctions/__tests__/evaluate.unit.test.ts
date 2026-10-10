/**
 * What a judged statement costs, and which questions travel together.
 *
 * The claims here are about *grouping and cost*, not about the judge: how many
 * requests one statement costs, which questions share a request, and which
 * reading each eval function takes off one verdict. What a cell holds when the
 * judge did not answer is `./evaluateSkips.unit.test.ts`; the judge's own
 * behaviour is the classifier suite's.
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
  threadSource,
} from "./evaluateFixtures";
import { hydrate, sourceOf } from "./hydrateFixtures";

describe("given one eval over an extracted conversation", () => {
  describe("when the statement is hydrated", () => {
    /** @scenario "The judged column carries the probability, not the conversation key" */
    it("puts the probability in the column and re-declares its type", async () => {
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
          evalOverConversation({ column: "annoyed", options: ["Annoyed"] }),
          evalOverConversation({
            column: "satisfaction",
            options: ["How satisfied", 1, 5],
            fn: "eval_score",
          }),
          evalOverConversation({
            column: "intent",
            options: [
              "What is asked for",
              ["refund: money back", "bug: broken"],
            ],
            fn: "eval_category",
          }),
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
          evalOverConversation({ column: "whole", options: ["Annoyed"] }),
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
      expect(traceSource.askedTraceIds).toEqual([]);
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
          evalOverConversation({ column: "probability", options: ["Annoyed"] }),
          evalOverConversation({
            column: "over",
            options: ["Annoyed", 0.7],
            fn: "eval_passed",
          }),
          evalOverConversation({
            column: "under",
            options: ["Annoyed", 0.9],
            fn: "eval_passed",
          }),
          evalOverConversation({
            column: "score",
            options: ["How satisfied", 1, 5],
            fn: "eval_score",
          }),
          evalOverConversation({
            column: "label",
            options: options,
            fn: "eval_category",
          }),
          evalOverConversation({
            column: "distribution",
            options: options,
            fn: "eval_category_probs",
          }),
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
