import { describe, expect, it } from "vitest";

import { admissionSeat } from "../admission-seat.ts";

describe("admissionSeat", () => {
  it("keeps the requested role while a full seat is free", () => {
    expect(admissionSeat({ requested: "ADMIN", fullSeatFree: true, liteSeatFree: false })).toEqual({
      role: "ADMIN",
      pending: false,
    });
  });

  it("admits a requested admin past the full seats as a Lite Member", () => {
    expect(admissionSeat({ requested: "ADMIN", fullSeatFree: false, liteSeatFree: true })).toEqual({
      role: "EXTERNAL",
      pending: false,
    });
  });

  it("holds the person pending when the Lite Member seats are used up too", () => {
    expect(
      admissionSeat({ requested: "MEMBER", fullSeatFree: false, liteSeatFree: false }),
    ).toEqual({ role: "EXTERNAL", pending: true });
  });

  it("never moves a Developer, whose seat is its own", () => {
    expect(
      admissionSeat({ requested: "DEVELOPER", fullSeatFree: false, liteSeatFree: false }),
    ).toEqual({ role: "DEVELOPER", pending: false });
  });
});
