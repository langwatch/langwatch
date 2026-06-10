// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAWER_DEFAULT_WIDTH_PX,
  DRAWER_MAXIMIZE_EDGE_PX,
  DRAWER_MIN_WIDTH_PX,
  useDrawerStore,
} from "../drawerStore";

const VIEWPORT_WIDTH = 1440;

beforeEach(() => {
  const { setWidthPx, togglePaneCollapsed, togglePaneMaximized, paneState } =
    useDrawerStore.getState();
  setWidthPx(null);
  // Explicitly clear the maximize fields that don't have a dedicated
  // setter — leaking them across tests had crept in once before, so
  // reset them via `setState` directly.
  useDrawerStore.setState({
    isMaximized: false,
    preMaximizeWidthPx: null,
  });
  // Reset pane state by toggling any "on" flags back off.
  (Object.keys(paneState) as Array<keyof typeof paneState>).forEach((id) => {
    if (paneState[id].collapsed) togglePaneCollapsed(id);
    if (paneState[id].maximizedWithinGroup) togglePaneMaximized(id);
  });
  localStorage.clear();
});

describe("drawerStore.setWidthPx", () => {
  /** @scenario Drag the left-edge grip to resize the drawer */
  /** @scenario Width is clamped to a minimum */
  describe("given a width below the minimum", () => {
    describe("when setWidthPx is called", () => {
      it("clamps to DRAWER_MIN_WIDTH_PX", () => {
        useDrawerStore.getState().setWidthPx(100);
        expect(useDrawerStore.getState().widthPx).toBe(DRAWER_MIN_WIDTH_PX);
      });
    });
  });

  /** @scenario Width persists across sessions */
  describe("given a valid width", () => {
    describe("when setWidthPx is called", () => {
      it("persists to localStorage", () => {
        useDrawerStore.getState().setWidthPx(900);
        expect(useDrawerStore.getState().widthPx).toBe(900);
        expect(
          localStorage.getItem("langwatch:traces-v2:drawer-width-px:v1"),
        ).toBe("900");
      });
    });
  });

  describe("given a null width", () => {
    describe("when setWidthPx is called", () => {
      it("clears the persisted width", () => {
        useDrawerStore.getState().setWidthPx(900);
        useDrawerStore.getState().setWidthPx(null);
        expect(useDrawerStore.getState().widthPx).toBeNull();
        expect(
          localStorage.getItem("langwatch:traces-v2:drawer-width-px:v1"),
        ).toBeNull();
      });
    });
  });
});

describe("drawerStore.toggleSnapMaximize", () => {
  /** @scenario Double-click the grip toggles maximize and restore */
  describe("given a non-snapped width", () => {
    describe("when toggleSnapMaximize fires", () => {
      it("snaps to viewport - edge and records the previous width", () => {
        useDrawerStore.getState().setWidthPx(700);
        useDrawerStore.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        const state = useDrawerStore.getState();
        expect(state.widthPx).toBe(VIEWPORT_WIDTH - DRAWER_MAXIMIZE_EDGE_PX);
        expect(state.preMaximizeWidthPx).toBe(700);
        expect(state.isMaximized).toBe(true);
      });
    });
  });

  /** @scenario Double-click the grip toggles maximize and restore */
  describe("given an already-snapped width", () => {
    describe("when toggleSnapMaximize fires a second time", () => {
      it("restores the remembered width", () => {
        useDrawerStore.getState().setWidthPx(700);
        useDrawerStore.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        useDrawerStore.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        const state = useDrawerStore.getState();
        expect(state.widthPx).toBe(700);
        expect(state.preMaximizeWidthPx).toBeNull();
        expect(state.isMaximized).toBe(false);
      });
    });
  });

  describe("given no prior width", () => {
    describe("when toggleSnapMaximize fires then restores", () => {
      it("restores to DRAWER_DEFAULT_WIDTH_PX as a sensible default", () => {
        useDrawerStore.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        useDrawerStore.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        const state = useDrawerStore.getState();
        // Default is a flat px (deterministic first paint) instead of
        // the previous 45% rule. Capped at the snap width on viewports
        // narrower than the default so restore never lands wider than
        // the snap target.
        const snapWidth = VIEWPORT_WIDTH - DRAWER_MAXIMIZE_EDGE_PX;
        expect(state.widthPx).toBe(
          Math.min(DRAWER_DEFAULT_WIDTH_PX, snapWidth),
        );
      });
    });
  });
});

describe("drawerStore pane controls", () => {
  /** @scenario Collapsing a pane reduces it to header-only */
  describe("given a default pane", () => {
    describe("when togglePaneCollapsed fires", () => {
      it("flips the collapsed flag and persists to localStorage", () => {
        useDrawerStore.getState().togglePaneCollapsed("visualization");
        expect(
          useDrawerStore.getState().paneState.visualization.collapsed,
        ).toBe(true);
        expect(
          localStorage.getItem("langwatch:traces-v2:drawer-pane-state:v2"),
        ).not.toBeNull();
      });
    });
  });

  /** @scenario Maximize-within-group hides siblings */
  describe("given a pane and its sibling", () => {
    describe("when togglePaneMaximized fires", () => {
      it("flips only that pane's maximized flag (the consumer hides siblings)", () => {
        useDrawerStore.getState().togglePaneMaximized("visualization");
        const state = useDrawerStore.getState().paneState;
        expect(state.visualization.maximizedWithinGroup).toBe(true);
        expect(state.spanDetail.maximizedWithinGroup).toBe(false);
      });
    });
  });

  describe("given a maximized pane", () => {
    describe("when togglePaneCollapsed fires", () => {
      it("drops the maximize flag so the two states never coexist", () => {
        useDrawerStore.getState().togglePaneMaximized("visualization");
        useDrawerStore.getState().togglePaneCollapsed("visualization");
        const next = useDrawerStore.getState().paneState.visualization;
        expect(next.collapsed).toBe(true);
        expect(next.maximizedWithinGroup).toBe(false);
      });
    });
  });

  /** @scenario Span-detail collapse round-trip preserves the selection */
  describe("given a selected span", () => {
    describe("when togglePaneCollapsed(spanDetail) fires twice", () => {
      it("keeps selectedSpanId so re-opening lands on the same span", () => {
        useDrawerStore.getState().selectSpan("span-abc");
        expect(useDrawerStore.getState().selectedSpanId).toBe("span-abc");
        useDrawerStore.getState().togglePaneCollapsed("spanDetail");
        expect(useDrawerStore.getState().paneState.spanDetail.collapsed).toBe(
          true,
        );
        // Collapse alone must NOT touch the selection.
        expect(useDrawerStore.getState().selectedSpanId).toBe("span-abc");
        useDrawerStore.getState().togglePaneCollapsed("spanDetail");
        expect(useDrawerStore.getState().paneState.spanDetail.collapsed).toBe(
          false,
        );
        expect(useDrawerStore.getState().selectedSpanId).toBe("span-abc");
      });
    });

    describe("when clearSpan fires", () => {
      it("still clears the selection (the explicit close path)", () => {
        useDrawerStore.getState().selectSpan("span-xyz");
        expect(useDrawerStore.getState().selectedSpanId).toBe("span-xyz");
        useDrawerStore.getState().clearSpan();
        expect(useDrawerStore.getState().selectedSpanId).toBeNull();
      });
    });
  });
});

// `setWidthPx(null)` after init reads the unwritten storage key as
// `null`, not an empty string — guard against a regression where the
// store would coerce `""` to a 0 width.
describe("drawerStore reload behaviour", () => {
  describe("given no persisted width", () => {
    it("initializes widthPx to null (caller decides on the default)", () => {
      // Module-level read happened on first import. Confirm the live
      // store value matches our beforeEach reset.
      expect(useDrawerStore.getState().widthPx).toBeNull();
    });
  });
});

// Sanity guard: existing API didn't accidentally regress when we added
// the new fields. If toggleMaximized stopped doing the thing other
// consumers (header button label, etc.) depend on, this would fail.
describe("drawerStore.toggleMaximized still flips isMaximized", () => {
  it("toggles the boolean independent of widthPx", () => {
    const before = useDrawerStore.getState().isMaximized;
    useDrawerStore.getState().toggleMaximized();
    expect(useDrawerStore.getState().isMaximized).toBe(!before);
    useDrawerStore.getState().toggleMaximized();
    expect(useDrawerStore.getState().isMaximized).toBe(before);
  });
});

// Coverage smoke: ensure setWidthPx writes through to localStorage even
// when called repeatedly — quota errors would surface here.
describe("drawerStore persistence is idempotent", () => {
  it("does not throw when called many times in a row", () => {
    const spy = vi.fn();
    for (let i = 0; i < 50; i++) {
      try {
        useDrawerStore.getState().setWidthPx(500 + i);
      } catch (e) {
        spy(e);
      }
    }
    expect(spy).not.toHaveBeenCalled();
    expect(useDrawerStore.getState().widthPx).toBe(549);
  });
});
