/**
 * What the family refuses before a handler runs.
 *
 * The ceilings a request is bounded by are schema rules, so they are checked
 * here rather than through a mounted route: a query past one of them never
 * reaches the service at all.
 *
 * @see ../schemas.ts
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_RESULTS_CEILING,
  INSTANT_EVAL_SAMPLE_CEILING,
} from "~/server/app-layer/instant-evals/run";
import {
  instantEvalListQuerySchema,
  instantEvalResultsQuerySchema,
  instantEvalSampleQuerySchema,
} from "../schemas";

describe("given a list requested with a cursor", () => {
  describe("when both halves of the cursor are given", () => {
    it("accepts them together", () => {
      const parsed = instantEvalListQuerySchema.safeParse({
        before: "2026-09-18T10:00:00.000Z",
        beforeId: "instant_eval_abc",
      });

      expect(parsed.success).toBe(true);
    });
  });

  describe("when neither half is given", () => {
    it("lists from the newest run", () => {
      expect(instantEvalListQuerySchema.safeParse({}).success).toBe(true);
    });
  });

  describe("when only one half is given", () => {
    /** @scenario "Half of the list's cursor is refused, naming the missing half" */
    it("refuses it and names the missing half", () => {
      const withoutId = instantEvalListQuerySchema.safeParse({
        before: "2026-09-18T10:00:00.000Z",
      });
      const withoutInstant = instantEvalListQuerySchema.safeParse({
        beforeId: "instant_eval_abc",
      });

      expect(withoutId.success).toBe(false);
      expect(withoutInstant.success).toBe(false);
      if (withoutId.success || withoutInstant.success) return;
      expect(withoutId.error.issues.map((issue) => issue.path)).toEqual([
        ["beforeId"],
      ]);
      expect(withoutInstant.error.issues.map((issue) => issue.path)).toEqual([
        ["before"],
      ]);
      expect(withoutId.error.issues[0]?.message).toContain("beforeId");
    });
  });
});

describe("given a sample requested for a hundred rows", () => {
  describe("when the request is validated", () => {
    /** @scenario "A sample is bounded to twenty five rows" */
    it("refuses it as past the sample ceiling", () => {
      const parsed = instantEvalSampleQuerySchema.safeParse({ n: "100" });

      expect(parsed.success).toBe(false);
      expect(
        instantEvalSampleQuerySchema.safeParse({
          n: String(INSTANT_EVAL_SAMPLE_CEILING),
        }).success,
      ).toBe(true);
    });
  });
});

describe("given a results page requested with no bounds", () => {
  describe("when the request is validated", () => {
    it("takes a default page size and refuses one past the ceiling", () => {
      const parsed = instantEvalResultsQuerySchema.parse({});

      expect(parsed.limit).toBe(100);
      expect(parsed.matched).toBeUndefined();
      expect(
        instantEvalResultsQuerySchema.safeParse({
          limit: String(INSTANT_EVAL_RESULTS_CEILING + 1),
        }).success,
      ).toBe(false);
    });
  });

  describe("when it names the matches it wants", () => {
    it("reads every spelling of the flag the way it is written", () => {
      expect(
        instantEvalResultsQuerySchema.parse({ matched: "false" }).matched,
      ).toBe(false);
      expect(
        instantEvalResultsQuerySchema.parse({ matched: "no" }).matched,
      ).toBe(false);
      expect(
        instantEvalResultsQuerySchema.parse({ matched: "1" }).matched,
      ).toBe(true);
    });
  });
});
