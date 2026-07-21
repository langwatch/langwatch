import { describe, expect, it } from "vitest";

import {
  compareLangyEventCursors,
  cursorHasReachedEvent,
  type LangyEventCursor,
} from "../cursor";

const at = (acceptedAt: number, eventId: string): LangyEventCursor => ({
  acceptedAt,
  eventId,
});

describe("compareLangyEventCursors", () => {
  it("orders by acceptedAt first", () => {
    expect(compareLangyEventCursors(at(1, "z"), at(2, "a"))).toBeLessThan(0);
    expect(compareLangyEventCursors(at(2, "a"), at(1, "z"))).toBeGreaterThan(0);
  });

  it("tie-breaks same-millisecond events by event id", () => {
    expect(compareLangyEventCursors(at(1, "a"), at(1, "b"))).toBeLessThan(0);
    expect(compareLangyEventCursors(at(1, "b"), at(1, "b"))).toBe(0);
  });

  it("tie-breaks byte-wise, never by locale collation", () => {
    // Locale collation typically sorts "a" before "B" (case-insensitive-ish);
    // byte order puts every uppercase ASCII letter first. KSUIDs are base62
    // with mixed case, so this distinction decides real orderings.
    expect("B".localeCompare("a")).toBeGreaterThan(0);
    expect(compareLangyEventCursors(at(1, "B"), at(1, "a"))).toBeLessThan(0);
  });
});

describe("cursorHasReachedEvent", () => {
  const cursor = at(1_000, "2AAAAAAAAAAAAAAAAAAAAAAAAAA");

  it("has reached an event strictly before it", () => {
    expect(
      cursorHasReachedEvent(cursor, { id: "1ZZZZZ", createdAt: 999 }),
    ).toBe(true);
  });

  it("has reached the event it points at (inclusive)", () => {
    expect(
      cursorHasReachedEvent(cursor, {
        id: "2AAAAAAAAAAAAAAAAAAAAAAAAAA",
        createdAt: 1_000,
      }),
    ).toBe(true);
  });

  it("has not reached a later same-millisecond event", () => {
    expect(
      cursorHasReachedEvent(cursor, {
        id: "2AAAAAAAAAAAAAAAAAAAAAAAAAB",
        createdAt: 1_000,
      }),
    ).toBe(false);
  });

  it("has not reached a later event", () => {
    expect(
      cursorHasReachedEvent(cursor, { id: "0AAAAA", createdAt: 1_001 }),
    ).toBe(false);
  });
});
