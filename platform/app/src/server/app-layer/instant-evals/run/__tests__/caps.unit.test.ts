/**
 * The row cap rule: what a run gets, and what it is refused for asking.
 *
 * @see ../caps.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_DEFAULT_ROW_CAP,
  INSTANT_EVAL_MAX_ROW_CAP,
  instantEvalRowCapFor,
  instantEvalRowLimitOrRefuse,
} from "../caps";

const free = { isFree: true, name: "Developer" };
const paid = { isFree: false, name: "Launch" };

describe("given a project asking for a run", () => {
  describe("when no limit is requested", () => {
    /** @scenario A run with no requested limit takes the default cap */
    it("takes the default cap on either plan", () => {
      expect(instantEvalRowLimitOrRefuse({ plan: free })).toBe(
        INSTANT_EVAL_DEFAULT_ROW_CAP,
      );
      // A paid plan's ceiling is higher, and an absent field still means the
      // default: the run is charged for what it judges.
      expect(instantEvalRowLimitOrRefuse({ plan: paid })).toBe(
        INSTANT_EVAL_DEFAULT_ROW_CAP,
      );
    });
  });

  describe("when the requested limit is past every plan's ceiling", () => {
    /** @scenario A limit past the raised cap is refused on every plan */
    it("refuses the run and names the highest cap any plan offers", () => {
      const refusal = (plan: { isFree: boolean; name: string }) => {
        try {
          instantEvalRowLimitOrRefuse({ requested: 200_000, plan });
          return null;
        } catch (error) {
          return error instanceof HandledError ? error : null;
        }
      };

      for (const plan of [free, paid]) {
        const error = refusal(plan);
        expect(error?.code).toBe("instant_eval_row_cap_exceeded");
        expect(error?.meta).toMatchObject({
          requested: 200_000,
          cap: instantEvalRowCapFor({ isFree: plan.isFree }),
          plan: plan.name,
          maxCap: INSTANT_EVAL_MAX_ROW_CAP,
        });
      }
    });
  });

  describe("when the requested limit is within the plan's ceiling", () => {
    it("gives the run the number it asked for", () => {
      expect(
        instantEvalRowLimitOrRefuse({ requested: 50_000, plan: paid }),
      ).toBe(50_000);
      expect(instantEvalRowLimitOrRefuse({ requested: 500, plan: free })).toBe(
        500,
      );
    });
  });
});
