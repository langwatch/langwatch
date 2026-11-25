import { MemberSeatLimitReachedError } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { readSeatRefusal } from "../seat-limit-refusal.rules.ts";

describe("readSeatRefusal", () => {
  it("reads the seat facts off a seat refusal", () => {
    const limit = { limitType: "members", current: 50, max: 50 } as const;
    const error = new MemberSeatLimitReachedError({ meta: limit });

    expect(readSeatRefusal(error)).toEqual({ kind: "seat-limit", limit });
  });

  it("answers other for any other error", () => {
    expect(readSeatRefusal(new Error("boom"))).toEqual({ kind: "other" });
  });
});
