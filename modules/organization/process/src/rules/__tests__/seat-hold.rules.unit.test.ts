import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { seatHoldOutcome } from "../seat-hold.rules.ts";

const now = Temporal.Instant.from("2026-11-06T12:00:00Z");
const daysAgo = (days: number) => now.subtract({ hours: days * 24 });

describe("seatHoldOutcome", () => {
  it("holds a seat taken under 30 days ago until 30 days after it was taken", () => {
    const outcome = seatHoldOutcome({ seatTakenAt: daysAgo(3), now });

    expect(outcome.kind).toBe("held");
    expect(outcome.kind === "held" && outcome.until.toString()).toBe("2026-12-03T12:00:00Z");
  });

  it("frees a seat taken 30 days ago or more at once", () => {
    expect(seatHoldOutcome({ seatTakenAt: daysAgo(30), now })).toEqual({ kind: "freed" });
    expect(seatHoldOutcome({ seatTakenAt: daysAgo(45), now })).toEqual({ kind: "freed" });
  });
});
