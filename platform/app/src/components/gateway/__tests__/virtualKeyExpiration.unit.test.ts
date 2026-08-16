import { describe, expect, it } from "vitest";

import {
  dateInputValue,
  earliestCustomDate,
  expirationStateFromStored,
  expiryFieldErrorFrom,
  formatExpiry,
  isExpired,
  resolveExpiresAt,
  VIRTUAL_KEY_EXPIRATION_OPTIONS,
} from "../virtualKeyExpiration";

/**
 * The date a period resolves to is the one fact the drawer states back, so
 * every rule about it is pinned here rather than read off the screen.
 */
describe("resolveExpiresAt", () => {
  const now = new Date("2026-08-16T10:30:00.000Z");

  describe("given the Never option", () => {
    it("resolves to no date at all", () => {
      expect(resolveExpiresAt({ preset: "", now })).toBeNull();
    });
  });

  describe("given a period", () => {
    it("counts the days forward from the moment it is picked", () => {
      expect(resolveExpiresAt({ preset: "1", now })?.toISOString()).toBe(
        "2026-08-17T10:30:00.000Z",
      );
      expect(resolveExpiresAt({ preset: "7", now })?.toISOString()).toBe(
        "2026-08-23T10:30:00.000Z",
      );
      expect(resolveExpiresAt({ preset: "365", now })?.toISOString()).toBe(
        "2027-08-16T10:30:00.000Z",
      );
    });

    it("offers a period for every option the select lists", () => {
      for (const option of VIRTUAL_KEY_EXPIRATION_OPTIONS) {
        if (option.value === "" || option.value === "custom") continue;
        expect(
          resolveExpiresAt({ preset: option.value, now })!.getTime(),
        ).toBeGreaterThan(now.getTime());
      }
    });
  });

  describe("given a custom date", () => {
    it("keeps the key working for the whole of the day that was picked", () => {
      expect(
        resolveExpiresAt({
          preset: "custom",
          customDate: "2026-08-20",
          now,
        })?.toISOString(),
      ).toBe("2026-08-20T23:59:59.999Z");
    });

    it("resolves to nothing while no date has been typed yet", () => {
      expect(resolveExpiresAt({ preset: "custom", now })).toBeNull();
      expect(
        resolveExpiresAt({ preset: "custom", customDate: "not-a-date", now }),
      ).toBeNull();
    });
  });
});

describe("earliestCustomDate", () => {
  it("refuses today, so the smallest answer is a whole day away", () => {
    expect(earliestCustomDate(new Date("2026-08-16T10:30:00.000Z"))).toBe(
      "2026-08-17",
    );
  });
});

describe("formatExpiry", () => {
  it("names the day that was picked, not the one a timezone rolls it into", () => {
    expect(formatExpiry(new Date("2026-08-20T23:59:59.999Z"))).toBe(
      "Thu, Aug 20, 2026",
    );
  });
});

describe("expirationStateFromStored", () => {
  describe("given a key with no expiration", () => {
    it("reads back as Never", () => {
      expect(expirationStateFromStored(null)).toEqual({
        preset: "",
        customDate: "",
      });
    });
  });

  describe("given a key with a stored date", () => {
    it("reads back as a custom date, since a period cannot round-trip", () => {
      expect(expirationStateFromStored("2026-08-20T23:59:59.999Z")).toEqual({
        preset: "custom",
        customDate: "2026-08-20",
      });
    });

    it("round-trips the same day back through the resolver", () => {
      const state = expirationStateFromStored("2026-09-01T12:00:00.000Z");
      expect(dateInputValue(resolveExpiresAt(state)!)).toBe("2026-09-01");
    });
  });
});

describe("isExpired", () => {
  const now = new Date("2026-08-16T10:30:00.000Z");

  it("says no for a key that never expires", () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(undefined, now)).toBe(false);
  });

  it("says no while the date is still ahead", () => {
    expect(isExpired("2026-08-16T10:30:00.001Z", now)).toBe(false);
  });

  it("says yes at the moment the date is reached", () => {
    expect(isExpired("2026-08-16T10:30:00.000Z", now)).toBe(true);
    expect(isExpired("2026-08-15T10:30:00.000Z", now)).toBe(true);
  });
});

describe("expiryFieldErrorFrom", () => {
  describe("when the server refused the date", () => {
    it("returns the complaint the field should carry", () => {
      expect(
        expiryFieldErrorFrom({
          data: {
            error: {
              code: "virtual_key_expiry_in_past",
              httpStatus: 400,
              meta: {
                fieldErrors: { expiresAt: ["Pick a date in the future"] },
              },
            },
          },
        }),
      ).toBe("Pick a date in the future");
    });
  });

  describe("when the failure is somebody else's", () => {
    it("returns nothing, so the toast still speaks", () => {
      expect(
        expiryFieldErrorFrom({
          data: { error: { code: "validation_error", httpStatus: 400 } },
        }),
      ).toBeNull();
      expect(expiryFieldErrorFrom(new Error("boom"))).toBeNull();
    });
  });
});
