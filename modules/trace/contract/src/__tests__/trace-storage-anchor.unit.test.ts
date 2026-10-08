import { describe, expect, it } from "vitest";

import { anchorStorageTime, firstUsableAnchor } from "../trace-storage-anchor.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("firstUsableAnchor()", () => {
  it("takes the first usable candidate", () => {
    expect(firstUsableAnchor({ candidates: [undefined, 0, NOW - 5, NOW - 9], now: NOW })).toBe(
      NOW - 5,
    );
  });

  it("skips a candidate more than a day in the future", () => {
    expect(firstUsableAnchor({ candidates: [NOW + DAY_MS + 1, NOW - 1], now: NOW })).toBe(NOW - 1);
  });

  it("falls back to now when no candidate is usable", () => {
    expect(firstUsableAnchor({ candidates: [undefined, -1], now: NOW })).toBe(NOW);
  });

  it("never returns epoch when now itself is unusable", () => {
    expect(firstUsableAnchor({ candidates: [], now: 0 })).toBeGreaterThan(0);
  });
});

describe("anchorStorageTime()", () => {
  it("keeps an anchor that is already frozen", () => {
    const state = { storageAnchorMs: NOW - 100, occurredAt: NOW - 50 };

    expect(anchorStorageTime({ state, eventOccurredAtMs: NOW - 10, now: NOW })).toBe(state);
  });

  it("freezes on the span start time before the envelope time", () => {
    const state = { occurredAt: NOW - 50 };

    expect(anchorStorageTime({ state, eventOccurredAtMs: NOW - 10, now: NOW })).toEqual({
      occurredAt: NOW - 50,
      storageAnchorMs: NOW - 50,
    });
  });

  it("freezes on the envelope time when no span has been folded", () => {
    const state = { occurredAt: 0 };

    expect(anchorStorageTime({ state, eventOccurredAtMs: NOW - 10, now: NOW })).toEqual({
      occurredAt: 0,
      storageAnchorMs: NOW - 10,
    });
  });

  it("leaves the state unanchored when neither time is usable", () => {
    const state = { occurredAt: 0 };

    expect(anchorStorageTime({ state, eventOccurredAtMs: undefined, now: NOW })).toBe(state);
  });
});
