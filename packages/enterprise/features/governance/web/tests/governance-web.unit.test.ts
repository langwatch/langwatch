import { describe, expect, it } from "vitest";
import {
  absorbFetch,
  buildPageRequest,
  cronFromPullParts,
  partsFromPullCron,
} from "../src";

describe("governance web logic", () => {
  it("round-trips a supported cadence", () => {
    const parts = {
      frequency: "weekly" as const,
      everyMinutes: 15,
      minute: 30,
      hour: 9,
      dayOfWeek: 1,
    };
    expect(partsFromPullCron(cronFromPullParts(parts))).toEqual(parts);
  });

  it("overlaps tied event timestamps without displaying duplicates", () => {
    const displayed = [{ eventId: "a", eventTimestampIso: "2026-01-01T00:00:00.000Z" }];
    const request = buildPageRequest({ pageSize: 1, displayedRows: displayed });
    expect(
      absorbFetch({
        pageSize: 1,
        request,
        fetched: [
          displayed[0]!,
          { eventId: "b", eventTimestampIso: "2025-12-31T23:59:59.000Z" },
        ],
      }).rows.map((row) => row.eventId),
    ).toEqual(["b"]);
  });
});
