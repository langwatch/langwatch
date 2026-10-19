/**
 * How a row stores the lite seats a license signs, and how it signs them back (WEB-19102).
 */
import { UNLIMITED } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { signedLiteSeats, storedLiteSeats } from "../lite-seats.rules.ts";

describe("the lite seats a row stores", () => {
  /** @scenario A licence with capped lite seats records the number */
  it("stores a capped count as the number, not unlimited", () => {
    expect(storedLiteSeats({ signed: 5 })).toEqual({
      maxMembersLite: 5,
      liteSeatsUnlimited: false,
    });
  });

  /** @scenario A licence that allows no lite seats records zero */
  it("stores no lite seats allowed as zero", () => {
    expect(storedLiteSeats({ signed: 0 })).toEqual({
      maxMembersLite: 0,
      liteSeatsUnlimited: false,
    });
  });

  /** @scenario A licence that states no lite seats records none */
  it("stores a licence that states no count as no count", () => {
    expect(storedLiteSeats({ signed: undefined })).toEqual({
      maxMembersLite: null,
      liteSeatsUnlimited: false,
    });
  });

  /** @scenario A purchased GROWTH licence is recorded with unlimited lite seats */
  it("stores unlimited as the flag and no count", () => {
    expect(storedLiteSeats({ signed: UNLIMITED })).toEqual({
      maxMembersLite: null,
      liteSeatsUnlimited: true,
    });
  });

  it("signs each stored meaning back as the licence stated it", () => {
    for (const signed of [5, 0, undefined, UNLIMITED]) {
      expect(signedLiteSeats(storedLiteSeats({ signed }))).toEqual({ membersLite: signed });
    }
  });
});
