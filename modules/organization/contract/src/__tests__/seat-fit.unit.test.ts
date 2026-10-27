import { describe, expect, it } from "vitest";

import { seatsFree } from "../seat-fit.ts";

const seats = { fullMembers: 2, liteMembers: 5, developers: 9 };

describe("seatsFree", () => {
  it("frees a pool only while it sits below its allowance", () => {
    expect(seatsFree({ plan: { maxMembers: 3, maxMembersLite: 5 }, seats })).toEqual({
      fullSeatFree: true,
      liteSeatFree: false,
    });
  });

  it("frees both pools when the plan lifts its limits", () => {
    expect(
      seatsFree({
        plan: { overrideAddingLimitations: true, maxMembers: 0, maxMembersLite: 0 },
        seats,
      }),
    ).toEqual({ fullSeatFree: true, liteSeatFree: true });
  });
});
