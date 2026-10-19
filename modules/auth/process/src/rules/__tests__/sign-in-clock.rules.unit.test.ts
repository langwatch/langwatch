import { describe, expect, it } from "vitest";

import { isIssuedAtWithinTolerance } from "../sign-in-clock.rules.ts";

const NOW = 1_800_000_000;

describe("isIssuedAtWithinTolerance", () => {
  it.each([
    { issuedAt: NOW + 120, accepted: true },
    { issuedAt: NOW + 121, accepted: false },
    { issuedAt: NOW - 3_720, accepted: true },
    { issuedAt: NOW - 3_721, accepted: false },
    { issuedAt: undefined, accepted: false },
    { issuedAt: String(NOW), accepted: false },
  ])("answers $accepted for an iat of $issuedAt", ({ issuedAt, accepted }) => {
    expect(isIssuedAtWithinTolerance({ issuedAt, nowSeconds: NOW })).toBe(accepted);
  });
});
