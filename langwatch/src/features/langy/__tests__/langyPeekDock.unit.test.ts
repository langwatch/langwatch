import { describe, expect, it } from "vitest";
import { FLOATING_PANEL_INSET } from "../logic/langyPanelLayout";
import {
  FLOATING_PEEK_REST_PX,
  PEEK_PROXIMITY_ENTER_PX,
  PEEK_PROXIMITY_EXIT_PX,
  resolvePeekProximity,
  resolvePeekTranslate,
  resolvePeekVisiblePx,
  SIDEBAR_PEEK_NEAR_PX,
  SIDEBAR_PEEK_REST_PX,
} from "../logic/langyPeekDock";

/**
 * The minimised peek's pure maths: how much sliver each phase shows, the
 * transform that produces it, and the pointer-proximity verdict with its
 * hysteresis. Spec: specs/langy/langy-peek-dock.feature
 */
describe("langyPeekDock geometry", () => {
  describe("given the floating panel is minimised", () => {
    it("rests findably, and still visibly rises", () => {
      const rest = resolvePeekVisiblePx({ mode: "floating", phase: "rest" });
      const near = resolvePeekVisiblePx({ mode: "floating", phase: "near" });
      // The first cut aimed to be "more hidden than the reference" and landed
      // at a lip only someone told to look for it could find — which made the
      // one way back to Langy invisible. Standing proud enough to read as a
      // docked thing is the requirement; being subtle is not.
      expect(rest).toBeGreaterThanOrEqual(24);
      // Rising is still a real change rather than a token nudge.
      expect(near - rest).toBeGreaterThanOrEqual(12);
      expect(rest).toBeLessThan(near);
    });

    it("slides the panel down its own height, less the sliver that stays", () => {
      // The card already rests FLOATING_PANEL_INSET above the viewport edge,
      // so only the remainder is travel.
      const travel = FLOATING_PEEK_REST_PX - FLOATING_PANEL_INSET;
      expect(resolvePeekTranslate({ mode: "floating", phase: "rest" })).toBe(
        `0 calc(100% - ${travel}px)`,
      );
    });

    it("rises by translating less, on the same axis — not by swapping states", () => {
      const rest = resolvePeekTranslate({ mode: "floating", phase: "rest" });
      const near = resolvePeekTranslate({ mode: "floating", phase: "near" });
      // Both are the same kind of value on the same property: one continuous
      // motion, which is what stops it reading as a pop.
      expect(rest.startsWith("0 calc(100% - ")).toBe(true);
      expect(near.startsWith("0 calc(100% - ")).toBe(true);
      expect(rest).not.toBe(near);
    });
  });

  describe("given the docked panel is minimised", () => {
    it("rests as a thinner sliver than it rises to", () => {
      const rest = resolvePeekVisiblePx({ mode: "sidebar", phase: "rest" });
      const near = resolvePeekVisiblePx({ mode: "sidebar", phase: "near" });
      expect(rest).toBeLessThan(near);
    });

    it("slides the dock right by its own width, less the visible spine", () => {
      expect(resolvePeekTranslate({ mode: "sidebar", phase: "rest" })).toBe(
        `calc(100% - ${SIDEBAR_PEEK_REST_PX}px) 0`,
      );
      expect(resolvePeekTranslate({ mode: "sidebar", phase: "near" })).toBe(
        `calc(100% - ${SIDEBAR_PEEK_NEAR_PX}px) 0`,
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
        // Midway between the two radii, measured from the RESTING SLIVER —
        // which is what proximity measures to. Taking it from the viewport
        // edge instead silently loses the sliver's own height, and lands the
        // pointer exactly ON the enter radius the moment that height changes.
        const betweenY =
          900 -
          FLOATING_PEEK_REST_PX -
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

    it("pops anywhere along that edge — the dock is full-height", () => {
      // The peek IS the dock, which runs top to bottom, so its whole right
      // edge is the target. (The retired stand-in was a short mid-height card,
      // which is why this used to be a dead zone.)
      expect(
        resolvePeekProximity({ ...base, pointerX: 1430, pointerY: 40 }),
      ).toBe(true);
      expect(
        resolvePeekProximity({ ...base, pointerX: 1430, pointerY: 860 }),
      ).toBe(true);
    });

    it("stays at rest for a pointer working out in the page", () => {
      expect(
        resolvePeekProximity({ ...base, pointerX: 500, pointerY: 450 }),
      ).toBe(false);
    });
  });
});
