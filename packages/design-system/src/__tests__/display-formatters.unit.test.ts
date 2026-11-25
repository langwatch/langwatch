import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { describeInstant } from "../describe-instant.ts";
import { describeNumber, formatCost, formatTokens } from "../display-formatters.ts";

describe("formatTokens and formatCost", () => {
  it("scales 3e9 to B, never 3000M", () => {
    expect(formatTokens(3e9, "en-US")).toBe("3B");
    expect(formatCost(3e9)).toBe("$3B");
  });

  it("keeps sub-unit values exact", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatCost(12.5)).toBe("$12.50");
  });

  it("groups by locale", () => {
    expect(describeNumber({ value: 2_000_000, locale: "en-US" })).toMatchObject({
      compact: "2M",
      integer: "2,000,000",
      precise: "2,000,000.00",
    });
    expect(describeNumber({ value: 2_000_000, locale: "de-DE" }).precise).toBe("2.000.000,00");
  });
});

describe("describeInstant", () => {
  const epochMs = Temporal.Instant.from("2026-01-15T12:00:00Z").epochMilliseconds;
  const base = { epochMs, locale: "en-US", viewerTimeZone: "UTC" };

  it("states the relative time", () => {
    expect(describeInstant({ ...base, nowMs: epochMs + 3 * 3_600_000 }).relative).toBe(
      "3 hours ago",
    );
    expect(describeInstant({ ...base, nowMs: epochMs - 2 * 86_400_000 }).relative).toBe(
      "in 2 days",
    );
  });

  it("compares the source zone with the viewer", () => {
    const d = describeInstant({ ...base, nowMs: epochMs, sourceTimeZone: "Asia/Tokyo" });
    expect(d.relativeToViewer).toBe("9h ahead of you");
    expect(d.source?.text).toContain("9:00");
  });
});
