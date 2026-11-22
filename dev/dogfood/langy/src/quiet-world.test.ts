import { describe, expect, it } from "vitest";

import { ageInHours } from "./quiet-world.ts";

describe("ageInHours", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");

  it("reads a ClickHouse DateTime as UTC", () => {
    expect(ageInHours({ newest: "2026-10-16 05:00:00.000", nowMs: now })).toBe(7);
  });

  it("reads an ISO timestamp", () => {
    expect(ageInHours({ newest: "2026-10-16T10:30:00Z", nowMs: now })).toBe(1.5);
  });

  it("gives null when there is no trace", () => {
    expect(ageInHours({ newest: "", nowMs: now })).toBeNull();
    expect(ageInHours({ newest: undefined, nowMs: now })).toBeNull();
  });
});
