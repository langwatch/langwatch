import { describe, expect, it } from "vitest";

import { planSchema } from "../protocol.ts";
import { ErrorStreak } from "../streak.ts";

const record = ({ streak, causes }: { streak: ErrorStreak; causes: string[] }): void => {
  for (const cause of causes) streak.record(cause);
};

describe("ErrorStreak", () => {
  it("stops at the limit and names the most common cause", () => {
    const streak = new ErrorStreak(4);
    record({ streak, causes: ["still loading", "page closed", "still loading"] });
    expect(streak.stopped).toBeUndefined();
    streak.record("still loading");
    expect(streak.stopped).toBe(
      "stopping: 4 consecutive errors, most common cause: still loading (x3)",
    );
  });

  it("is ended by a visit that worked", () => {
    const streak = new ErrorStreak(3);
    record({ streak, causes: ["page closed", "page closed", "", "page closed"] });
    expect(streak.stopped).toBeUndefined();
  });

  it("never stops when the limit is 0", () => {
    const streak = new ErrorStreak(0);
    record({ streak, causes: Array.from({ length: 500 }, () => "page closed") });
    expect(streak.stopped).toBeUndefined();
  });

  it("keeps the reason it first tripped with", () => {
    const streak = new ErrorStreak(2);
    record({ streak, causes: ["a", "a", "b", "b", "b"] });
    expect(streak.stopped).toBe("stopping: 2 consecutive errors, most common cause: a (x2)");
  });
});

describe("planSchema", () => {
  const credential = { email: "a@b.c", password: "x" };

  it("defaults the limit to 10", () => {
    expect(planSchema.parse({ url: "http://x", credential }).maxConsecutiveErrors).toBe(10);
  });

  it("takes 0 as disabled", () => {
    const plan = planSchema.parse({ url: "http://x", credential, maxConsecutiveErrors: 0 });
    expect(plan.maxConsecutiveErrors).toBe(0);
  });
});
