import { describe, expect, it } from "vitest";

import {
  LANGY_FLOATING_FLOOR_EMPTY_PX,
  LANGY_FLOATING_FLOOR_THREAD_PX,
  LANGY_FLOATING_FLOOR_TURN_PX,
  langyRestingFloorPx,
} from "../logic/langyPanelLayout";

/**
 * The floating card's resting floor. The interesting case is the one the panel
 * used to get wrong: a conversation the panel REMEMBERED but has not loaded
 * yet is not an empty one, and sizing it as empty made it open small and step
 * up as its history landed.
 */
describe("langyRestingFloorPx", () => {
  describe("given a genuinely empty, settled thread", () => {
    it("rests on the compact floor", () => {
      expect(
        langyRestingFloorPx({ emptyAndSettled: true, expectedMessageCount: 0 }),
      ).toBe(LANGY_FLOATING_FLOOR_EMPTY_PX);
    });
  });

  describe("given a thread holding a single turn", () => {
    it("stands at the turn floor", () => {
      expect(
        langyRestingFloorPx({ emptyAndSettled: false, expectedMessageCount: 1 }),
      ).toBe(LANGY_FLOATING_FLOOR_TURN_PX);
    });
  });

  describe("given a thread of several messages", () => {
    it("stands at the thread floor", () => {
      expect(
        langyRestingFloorPx({ emptyAndSettled: false, expectedMessageCount: 6 }),
      ).toBe(LANGY_FLOATING_FLOOR_THREAD_PX);
    });
  });

  describe("when a remembered conversation is still loading", () => {
    // The panel passes the count the recents list already knows, so the card
    // opens at the size the messages will need rather than on the empty floor.
    /** @scenario A restored conversation opens at the size its content will need */
    it("opens at the size the coming messages need, not the empty floor", () => {
      const restoring = langyRestingFloorPx({
        emptyAndSettled: false,
        expectedMessageCount: 6,
      });

      expect(restoring).toBe(LANGY_FLOATING_FLOOR_THREAD_PX);
      expect(restoring).toBeGreaterThan(LANGY_FLOATING_FLOOR_EMPTY_PX);
    });

    // The recents list may not have landed either, leaving the count unknown
    // (the panel passes 0). Even then the card must not rest on the empty
    // floor: we know a conversation is coming, just not how big.
    it("clears the empty floor even when the count is not known yet", () => {
      expect(
        langyRestingFloorPx({ emptyAndSettled: false, expectedMessageCount: 0 }),
      ).toBeGreaterThan(LANGY_FLOATING_FLOOR_EMPTY_PX);
    });
  });
});
