import { describe, expect, it } from "vitest";

import {
  breakGlassCandidateLabel,
  breakGlassHolderName,
  liveBreakGlassGrants,
  type BreakGlassGrantView,
} from "../break-glass-grants.ts";

const grant = (overrides: Partial<BreakGlassGrantView> = {}): BreakGlassGrantView => ({
  bindingId: "bg_1",
  userId: "user_1",
  name: "Jane Doe",
  email: "jane@acme.com",
  grantedByName: "Sam Owner",
  expiresAtMs: Date.UTC(2026, 0, 9),
  daysRemaining: 12,
  live: true,
  ...overrides,
});

describe("liveBreakGlassGrants", () => {
  it("offers only the grants that are still a way in", () => {
    const grants = [
      grant({ bindingId: "bg_live" }),
      grant({ bindingId: "bg_superseded", live: false }),
    ];

    expect(liveBreakGlassGrants(grants).map((entry) => entry.bindingId)).toEqual(["bg_live"]);
  });
});

describe("breakGlassHolderName", () => {
  it("names the person, and falls back to the address before the id", () => {
    expect(breakGlassHolderName(grant())).toBe("Jane Doe");
    expect(breakGlassHolderName(grant({ name: null }))).toBe("jane@acme.com");
    expect(breakGlassHolderName(grant({ name: null, email: null }))).toBe("user_1");
  });
});

describe("breakGlassCandidateLabel", () => {
  it("says why somebody who holds no password cannot hold a way back in", () => {
    expect(
      breakGlassCandidateLabel({
        userId: "user_2",
        name: "Ada",
        email: "ada@acme.com",
        holdsPassword: false,
      }),
    ).toBe("Ada (set a password first)");
  });

  it("leaves an eligible administrator's name alone, known or unknown", () => {
    expect(
      breakGlassCandidateLabel({ userId: "user_2", name: "Ada", email: null, holdsPassword: true }),
    ).toBe("Ada");
    expect(breakGlassCandidateLabel({ userId: "user_3", name: null, email: null })).toBe("user_3");
  });
});
