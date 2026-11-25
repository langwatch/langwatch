/**
 * Regression: an evaluate call with no `data` reached the dispatch rules as
 * undefined and crashed reading `contexts`. Main refused it with a 400.
 */
import { describe, expect, it } from "vitest";

import { evaluationInputSchema } from "../evaluation-legacy.schemas.ts";

describe("evaluationInputSchema", () => {
  describe("when the request carries no data", () => {
    it("refuses a body without data", () => {
      const result = evaluationInputSchema.safeParse({ settings: {} });

      expect(result.success).toBe(false);
    });

    it("refuses a body whose data is null", () => {
      const result = evaluationInputSchema.safeParse({ data: null });

      expect(result.success).toBe(false);
    });

    it("accepts an empty data object", () => {
      const result = evaluationInputSchema.safeParse({ data: {} });

      expect(result.success).toBe(true);
    });
  });
});
