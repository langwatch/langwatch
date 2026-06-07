import { describe, expect, it } from "vitest";

import { conversationTurnsWindow } from "../useConversationTurns";

const HOUR_MS = 60 * 60 * 1000;

// A fixed hour boundary (2026-06-07T09:00:00.000Z) so the assertions don't
// depend on wall-clock time.
const HOUR_START = Date.UTC(2026, 5, 7, 9, 0, 0, 0);

describe("conversationTurnsWindow", () => {
  describe("given a turn recorded earlier in the current clock hour", () => {
    it("keeps the turn inside the window instead of flooring the upper bound to the hour start", () => {
      // Drawer opened 30 min into the hour; the latest turn landed at 18 min.
      const now = HOUR_START + 30 * 60 * 1000;
      const latestTurnAt = HOUR_START + 18 * 60 * 1000;

      const { from, to } = conversationTurnsWindow(now);

      // The regression: a floored upper bound (HOUR_START) sits before the
      // turn's OccurredAt, so the turn falls outside the window and the
      // Conversation tab renders "No turns found". The rounded-up bound keeps
      // it inside.
      expect(latestTurnAt).toBeGreaterThanOrEqual(from);
      expect(latestTurnAt).toBeLessThanOrEqual(to);
      expect(to).toBeGreaterThanOrEqual(now);
    });
  });

  describe("given two opens within the same clock hour", () => {
    it("returns an identical window so the query key stays cached", () => {
      const early = conversationTurnsWindow(HOUR_START + 5 * 60 * 1000);
      const late = conversationTurnsWindow(HOUR_START + 55 * 60 * 1000);

      expect(early).toEqual(late);
    });
  });

  describe("given a 90-day lookback", () => {
    it("spans exactly 90 days from the rounded upper bound", () => {
      const { from, to } = conversationTurnsWindow(HOUR_START + 12 * 60 * 1000);

      expect(to - from).toBe(90 * 24 * HOUR_MS);
    });
  });
});
