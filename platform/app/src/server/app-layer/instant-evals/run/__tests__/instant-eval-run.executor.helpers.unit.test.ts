/**
 * The executor's pure helpers: the page size a sample of texts earns, the
 * average size of those texts, and the hydration plan read back off a run.
 *
 * @see ../instant-eval-run.sizing.ts
 * @see ../instant-eval-run.executor.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import { instantEvalHydrationPlan } from "../instant-eval-run.executor";
import {
  INSTANT_EVAL_LARGE_TEXT_BYTES,
  INSTANT_EVAL_PAGE_SIZE,
  INSTANT_EVAL_SMALL_PAGE_SIZE,
  instantEvalAverageTextBytes,
  instantEvalKeyCapFor,
  instantEvalPageSizeFor,
} from "../instant-eval-run.sizing";
import { calls } from "./instantEvalRunExecutorFakes";

describe("given a sample of a page's texts", () => {
  describe("when the page size is chosen from them", () => {
    /** @scenario "A page of large texts is smaller than a page of small ones" */
    it("cuts the page to a fifth past the large-text mark", () => {
      expect(instantEvalPageSizeFor({ averageTextBytes: 1_000 })).toBe(
        INSTANT_EVAL_PAGE_SIZE,
      );
      expect(
        instantEvalPageSizeFor({
          averageTextBytes: INSTANT_EVAL_LARGE_TEXT_BYTES + 1,
        }),
      ).toBe(INSTANT_EVAL_SMALL_PAGE_SIZE);
    });
  });

  describe("when the statement reads a kind of key with a lower cap", () => {
    /** @scenario "A page never exceeds the key cap of the statement's own functions" */
    it("cuts the page to the cap rather than failing the run on it", () => {
      // `conversation_bounded` reads thread keys, capped at 200. A 500 row
      // page over conversations was refused by the hydration stage, which
      // fails the whole run instead of returning fewer rows, so every run
      // over 200 conversations died with lwql_app_function_key_cap.
      const threadCalls = [
        {
          column: "q1",
          function: "eval",
          options: [],
          source: { function: "conversation_bounded", options: [] },
        },
      ] as never;

      expect(instantEvalKeyCapFor(threadCalls)).toBe(200);
      expect(
        instantEvalPageSizeFor({
          averageTextBytes: 1_000,
          keyCap: instantEvalKeyCapFor(threadCalls),
        }),
      ).toBe(200);
    });

    /** @scenario "A statement over traces keeps the full page" */
    it("leaves a trace statement's page at the default", () => {
      const traceCalls = [
        {
          column: "q1",
          function: "eval",
          options: [],
          source: { function: "llm_readable_trace", options: [] },
        },
      ] as never;

      expect(
        instantEvalPageSizeFor({
          averageTextBytes: 1_000,
          keyCap: instantEvalKeyCapFor(traceCalls),
        }),
      ).toBe(INSTANT_EVAL_PAGE_SIZE);
    });

    /** @scenario "A large-text page stays small even when the cap is higher" */
    it("keeps the smaller of the two bounds", () => {
      expect(
        instantEvalPageSizeFor({
          averageTextBytes: INSTANT_EVAL_LARGE_TEXT_BYTES + 1,
          keyCap: 1_000,
        }),
      ).toBe(INSTANT_EVAL_SMALL_PAGE_SIZE);
    });
  });

  describe("when their average size is measured", () => {
    it("counts only the judged columns", () => {
      const average = instantEvalAverageTextBytes({
        rows: [
          { annoyed: "12345678", other: "ignored because it asks nothing" },
          { annoyed: "1234" },
        ],
        questionIds: ["annoyed"],
      });

      expect(average).toBe(6);
    });

    it("reports nothing when no column held text", () => {
      expect(
        instantEvalAverageTextBytes({
          rows: [{ annoyed: null }],
          questionIds: ["annoyed"],
        }),
      ).toBe(0);
    });
  });
});

describe("given the hydration plan stored on a run", () => {
  describe("when it is read back", () => {
    it("returns the calls the validator recorded", () => {
      expect(
        instantEvalHydrationPlan(JSON.parse(JSON.stringify(calls))),
      ).toEqual(calls);
    });

    it("drops an entry that is not a call", () => {
      expect(
        instantEvalHydrationPlan([{ column: "x" }, null, "nonsense"]),
      ).toEqual([]);
    });

    it("returns nothing for a column that is not a list", () => {
      expect(instantEvalHydrationPlan({ not: "a list" })).toEqual([]);
    });
  });
});

describe("given the statement's own functions", () => {
  describe("when the statement reads a kind of key with a lower cap", () => {
    /** @scenario "A page never exceeds the key cap of the statement's own functions" */
    it("cuts the page to the cap rather than failing the run on it", () => {
      // `conversation_bounded` reads thread keys, capped at 200. A 500 row
      // page over conversations was refused by the hydration stage, which
      // fails the whole run instead of returning fewer rows, so every run
      // over 200 conversations died with lwql_app_function_key_cap.
      const threadCalls = [
        {
          column: "q1",
          function: "eval",
          options: [],
          source: { function: "conversation_bounded", options: [] },
        },
      ] as never;

      expect(instantEvalKeyCapFor(threadCalls)).toBe(200);
      expect(
        instantEvalPageSizeFor({
          averageTextBytes: 1_000,
          keyCap: instantEvalKeyCapFor(threadCalls),
        }),
      ).toBe(200);
    });

    /** @scenario "A statement over traces keeps the full page" */
    it("leaves a trace statement's page at the default", () => {
      const traceCalls = [
        {
          column: "q1",
          function: "eval",
          options: [],
          source: { function: "llm_readable_trace", options: [] },
        },
      ] as never;

      expect(
        instantEvalPageSizeFor({
          averageTextBytes: 1_000,
          keyCap: instantEvalKeyCapFor(traceCalls),
        }),
      ).toBe(INSTANT_EVAL_PAGE_SIZE);
    });

    /** @scenario "A large-text page stays small even when the cap is higher" */
    it("keeps the smaller of the two bounds", () => {
      expect(
        instantEvalPageSizeFor({
          averageTextBytes: INSTANT_EVAL_LARGE_TEXT_BYTES + 1,
          keyCap: 1_000,
        }),
      ).toBe(INSTANT_EVAL_SMALL_PAGE_SIZE);
    });
  });
});
