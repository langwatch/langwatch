import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";
import { dailyCapAdvice, isPersistAction } from "../model/daily-cap-advice";

const overCap = {
  action: TriggerAction.ADD_TO_DATASET as string,
  matchesPerDay: 420,
  cap: 100,
};

describe("isPersistAction", () => {
  it("accepts the dataset action", () => {
    expect(isPersistAction(TriggerAction.ADD_TO_DATASET)).toBe(true);
  });

  it("accepts the annotation-queue action", () => {
    expect(isPersistAction(TriggerAction.ADD_TO_ANNOTATION_QUEUE)).toBe(true);
  });

  it("rejects a notify action", () => {
    expect(isPersistAction(TriggerAction.SEND_SLACK_MESSAGE)).toBe(false);
  });

  it("rejects an unset action", () => {
    expect(isPersistAction(null)).toBe(false);
  });
});

describe("dailyCapAdvice", () => {
  describe("given a persist-class action", () => {
    describe("when the estimate is over the plan ceiling", () => {
      /** @scenario "An over-ceiling condition on a persist action resolves to advice" */
      it("returns the rounded estimate and the ceiling", () => {
        expect(dailyCapAdvice(overCap)).toEqual({ perDay: 420, cap: 100 });
      });

      it("rounds a fractional estimate for display", () => {
        expect(dailyCapAdvice({ ...overCap, matchesPerDay: 142.6 })?.perDay).toBe(143);
      });

      it("flags the annotation-queue action too", () => {
        expect(
          dailyCapAdvice({
            ...overCap,
            action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
          }),
        ).toEqual({ perDay: 420, cap: 100 });
      });
    });

    describe("when the estimate is within the plan ceiling", () => {
      /** @scenario "A condition within the ceiling resolves to no advice" */
      it("returns nothing", () => {
        expect(dailyCapAdvice({ ...overCap, matchesPerDay: 12 })).toBeNull();
      });

      it("returns nothing when the estimate rounds to exactly the ceiling", () => {
        // "About 100 a day is over your limit of 100" would read as a bug.
        expect(dailyCapAdvice({ ...overCap, matchesPerDay: 100.4 })).toBeNull();
      });
    });
  });

  describe("given a notify-class action", () => {
    /** @scenario "A notify action is never flagged against the ceiling" */
    it("returns nothing even far over the ceiling", () => {
      expect(dailyCapAdvice({ ...overCap, action: TriggerAction.SEND_EMAIL })).toBeNull();
    });
  });

  describe("given a missing input", () => {
    /** @scenario "A failed estimate or ceiling read says nothing" */
    it("returns nothing without an estimate", () => {
      expect(dailyCapAdvice({ ...overCap, matchesPerDay: null })).toBeNull();
    });

    it("returns nothing without a ceiling", () => {
      expect(dailyCapAdvice({ ...overCap, cap: null })).toBeNull();
    });

    it("returns nothing for an unset action", () => {
      expect(dailyCapAdvice({ ...overCap, action: null })).toBeNull();
    });

    it("returns nothing for a non-finite estimate", () => {
      expect(dailyCapAdvice({ ...overCap, matchesPerDay: Number.NaN })).toBeNull();
    });

    it("returns nothing for a ceiling of zero", () => {
      expect(dailyCapAdvice({ ...overCap, cap: 0 })).toBeNull();
    });
  });
});
