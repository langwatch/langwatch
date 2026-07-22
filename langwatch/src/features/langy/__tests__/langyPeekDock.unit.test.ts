import { describe, expect, it } from "vitest";
import {
  FLOATING_PEEK_CARD_HEIGHT,
  FLOATING_PEEK_NEAR_PX,
  FLOATING_PEEK_REST_PX,
  PEEK_PROXIMITY_ENTER_PX,
  PEEK_PROXIMITY_EXIT_PX,
  resolvePeekHiddenTransform,
  resolvePeekProximity,
  resolvePeekTransform,
  resolvePeekVisiblePx,
  SIDEBAR_PEEK_CARD_WIDTH,
  SIDEBAR_PEEK_NEAR_PX,
  SIDEBAR_PEEK_REST_PX,
} from "../logic/langyPeekDock";

/**
 * The minimised peek's pure maths: how much sliver each phase shows, the
 * transform that produces it, and the pointer-proximity verdict with its
 * hysteresis. Spec: specs/langy/langy-peek-dock.feature
 */
describe("langyPeekDock geometry", () => {
  describe("given the floating card is minimised", () => {
    it("rests findably, and still visibly rises", () => {
      const rest = resolvePeekVisiblePx({ mode: "floating", phase: "rest" });
      const near = resolvePeekVisiblePx({ mode: "floating", phase: "near" });
      // The first cut rested at a lip deliberately "more hidden" than the
      // reference — and in practice nobody could find it. A dock you have to
      // already know about is not a dock, so the resting sliver now has to
      // stand proud enough to read as one.
      expect(rest).toBeGreaterThanOrEqual(20);
      // Rising is still a real change rather than a token nudge, and the card
      // never rises past its own height.
      expect(near - rest).toBeGreaterThanOrEqual(12);
      expect(near).toBeLessThan(FLOATING_PEEK_CARD_HEIGHT);
    });

    it("translates the sunk card so exactly the sliver stays above the edge", () => {
      expect(resolvePeekTransform({ mode: "floating", phase: "rest" })).toBe(
        `translateY(${FLOATING_PEEK_CARD_HEIGHT - FLOATING_PEEK_REST_PX}px)`,
      );
      expect(resolvePeekTransform({ mode: "floating", phase: "near" })).toBe(
        `translateY(${FLOATING_PEEK_CARD_HEIGHT - FLOATING_PEEK_NEAR_PX}px)`,
      );
    });

    it("starts its entrance fully sunk below the edge", () => {
      expect(resolvePeekHiddenTransform("floating")).toBe(
        `translateY(${FLOATING_PEEK_CARD_HEIGHT}px)`,
      );
    });
  });

  describe("given the sidebar dock is minimised", () => {
    it("rests as a thinner sliver than it rises to", () => {
      const rest = resolvePeekVisiblePx({ mode: "sidebar", phase: "rest" });
      const near = resolvePeekVisiblePx({ mode: "sidebar", phase: "near" });
      expect(rest).toBeLessThan(near);
    });

    it("translates off the right edge and keeps its own vertical centring", () => {
      expect(resolvePeekTransform({ mode: "sidebar", phase: "rest" })).toBe(
        `translate(${SIDEBAR_PEEK_CARD_WIDTH - SIDEBAR_PEEK_REST_PX}px, -50%)`,
      );
      expect(resolvePeekTransform({ mode: "sidebar", phase: "near" })).toBe(
        `translate(${SIDEBAR_PEEK_CARD_WIDTH - SIDEBAR_PEEK_NEAR_PX}px, -50%)`,
      );
      expect(resolvePeekHiddenTransform("sidebar")).toBe(
        `translate(${SIDEBAR_PEEK_CARD_WIDTH}px, -50%)`,
      );
    });
  });
});

describe("langyPeekDock proximity", () => {
  const viewport = { viewportWidth: 1440, viewportHeight: 900 };

  describe("given the floating peek rests bottom-right", () => {
    const base = {
      ...viewport,
      mode: "floating" as const,
      dodgeLeft: false,
      wasNear: false,
    };

    it("stays at rest while the pointer works elsewhere on the page", () => {
      expect(
        resolvePeekProximity({ ...base, pointerX: 200, pointerY: 200 }),
      ).toBe(false);
    });

    it("pops when the pointer nears the bottom-right region", () => {
      // Just above the resting sliver, inside the enter radius.
      expect(
        resolvePeekProximity({
          ...base,
          pointerX: 1200,
          pointerY: 900 - PEEK_PROXIMITY_ENTER_PX + 10,
        }),
      ).toBe(true);
    });

    it("does not pop for a pointer at the bottom-LEFT of the viewport", () => {
      expect(
        resolvePeekProximity({ ...base, pointerX: 60, pointerY: 890 }),
      ).toBe(false);
    });

    describe("when a drawer holds the corner and the peek dodged left", () => {
      it("the zone follows it to the bottom-left", () => {
        const dodged = { ...base, dodgeLeft: true };
        expect(
          resolvePeekProximity({ ...dodged, pointerX: 60, pointerY: 890 }),
        ).toBe(true);
        expect(
          resolvePeekProximity({ ...dodged, pointerX: 1400, pointerY: 890 }),
        ).toBe(false);
      });
    });

    describe("when the pointer hovers right on the boundary", () => {
      it("holds its verdict — enter and exit radii differ (hysteresis)", () => {
        // Between the two thresholds: distance ~170px above the sliver.
        const betweenY =
          900 -
          (PEEK_PROXIMITY_ENTER_PX + PEEK_PROXIMITY_EXIT_PX) / 2;
        const between = { ...base, pointerX: 1200, pointerY: betweenY };
        // Approaching from afar: not yet near.
        expect(resolvePeekProximity({ ...between, wasNear: false })).toBe(
          false,
        );
        // Retreating from near: still near.
        expect(resolvePeekProximity({ ...between, wasNear: true })).toBe(true);
      });
    });
  });

  describe("given the sidebar peek rests mid-height on the right edge", () => {
    const base = {
      ...viewport,
      mode: "sidebar" as const,
      dodgeLeft: false,
      wasNear: false,
    };

    it("pops for a pointer drifting toward the right edge, mid-height", () => {
      expect(
        resolvePeekProximity({ ...base, pointerX: 1350, pointerY: 450 }),
      ).toBe(true);
    });

    it("stays at rest for a pointer at the right edge's far corners", () => {
      // Same edge, but far above the sliver's band — nowhere near the peek.
      expect(
        resolvePeekProximity({ ...base, pointerX: 1430, pointerY: 40 }),
      ).toBe(false);
    });
  });
});
