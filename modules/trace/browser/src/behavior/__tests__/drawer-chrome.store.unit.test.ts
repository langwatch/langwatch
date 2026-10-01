import {
  clearReaderUiStorage,
  readerUiStorage,
  setUiStorageReader,
} from "@langwatch/browser-host/storage";
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  DRAWER_DEFAULT_WIDTH_PX,
  DRAWER_MAXIMIZE_EDGE_PX,
  DRAWER_MIN_WIDTH_PX,
  drawerChrome,
} from "../drawer-chrome.store.ts";

const VIEWPORT_WIDTH = 1440;
const STORAGE_KEY = "langwatch:traces-v2:drawer-chrome";

const stored = (): { state: Record<string, unknown> } | null => {
  const raw = readerUiStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
};

beforeEach(() => {
  clearReaderUiStorage();
  localStorage.clear();
  setUiStorageReader("reader-1");
  drawerChrome.setState(drawerChrome.getInitialState(), true);
});

describe("drawer chrome width", () => {
  describe("given a width below the minimum", () => {
    describe("when setWidthPx is called", () => {
      /** @scenario Drag the left-edge grip to resize the drawer */
      /** @scenario Width is clamped to a minimum */
      it("clamps to DRAWER_MIN_WIDTH_PX", () => {
        drawerChrome.getState().setWidthPx(100);
        expect(drawerChrome.getState().widthPx).toBe(DRAWER_MIN_WIDTH_PX);
      });
    });
  });

  describe("given a valid width", () => {
    describe("when setWidthPx is called", () => {
      /** @scenario Width persists across sessions */
      it("remembers it on this device", () => {
        drawerChrome.getState().setWidthPx(900);
        expect(drawerChrome.getState().widthPx).toBe(900);
        expect(stored()?.state.widthPx).toBe(900);
      });
    });
  });

  describe("given a null width", () => {
    describe("when setWidthPx is called", () => {
      it("forgets the remembered width", () => {
        drawerChrome.getState().setWidthPx(900);
        drawerChrome.getState().setWidthPx(null);
        expect(drawerChrome.getState().widthPx).toBeNull();
        expect(stored()?.state.widthPx).toBeNull();
      });
    });
  });
});

describe("drawer chrome toggleSnapMaximize", () => {
  describe("given a non-snapped width", () => {
    describe("when toggleSnapMaximize fires", () => {
      /** @scenario Double-click the grip toggles maximize and restore */
      it("snaps to viewport - edge and records the previous width", () => {
        drawerChrome.getState().setWidthPx(700);
        drawerChrome.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        const state = drawerChrome.getState();
        expect(state.widthPx).toBe(VIEWPORT_WIDTH - DRAWER_MAXIMIZE_EDGE_PX);
        expect(state.preMaximizeWidthPx).toBe(700);
        expect(state.isMaximized).toBe(true);
      });
    });
  });

  describe("given an already-snapped width", () => {
    describe("when toggleSnapMaximize fires a second time", () => {
      /** @scenario Double-click the grip toggles maximize and restore */
      it("restores the remembered width", () => {
        drawerChrome.getState().setWidthPx(700);
        drawerChrome.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        drawerChrome.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        const state = drawerChrome.getState();
        expect(state.widthPx).toBe(700);
        expect(state.preMaximizeWidthPx).toBeNull();
        expect(state.isMaximized).toBe(false);
      });
    });
  });

  describe("given no prior width", () => {
    describe("when toggleSnapMaximize fires then restores", () => {
      it("restores to DRAWER_DEFAULT_WIDTH_PX as a sensible default", () => {
        drawerChrome.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        drawerChrome.getState().toggleSnapMaximize(VIEWPORT_WIDTH);
        // Capped at the snap width on narrow viewports, so restore never lands wider than it.
        const snapWidth = VIEWPORT_WIDTH - DRAWER_MAXIMIZE_EDGE_PX;
        expect(drawerChrome.getState().widthPx).toBe(Math.min(DRAWER_DEFAULT_WIDTH_PX, snapWidth));
      });
    });
  });
});

describe("drawer chrome pane controls", () => {
  describe("given a default pane", () => {
    describe("when togglePaneCollapsed fires", () => {
      /** @scenario Collapsing a pane reduces it to header-only */
      it("flips the collapsed flag and remembers it", () => {
        drawerChrome.getState().togglePaneCollapsed("visualization");
        expect(drawerChrome.getState().paneState.visualization.collapsed).toBe(true);
        expect(stored()?.state.paneState).toMatchObject({ visualization: { collapsed: true } });
      });
    });
  });

  describe("given a pane and its sibling", () => {
    describe("when togglePaneMaximized fires", () => {
      /** @scenario Maximize-within-group hides siblings */
      it("flips only that pane's maximized flag (the consumer hides siblings)", () => {
        drawerChrome.getState().togglePaneMaximized("visualization");
        const state = drawerChrome.getState().paneState;
        expect(state.visualization.maximizedWithinGroup).toBe(true);
        expect(state.spanDetail.maximizedWithinGroup).toBe(false);
      });
    });
  });

  describe("given a maximized pane", () => {
    describe("when togglePaneCollapsed fires", () => {
      it("drops the maximize flag so the two states never coexist", () => {
        drawerChrome.getState().togglePaneMaximized("visualization");
        drawerChrome.getState().togglePaneCollapsed("visualization");
        const next = drawerChrome.getState().paneState.visualization;
        expect(next.collapsed).toBe(true);
        expect(next.maximizedWithinGroup).toBe(false);
      });
    });
  });

  describe("given a collapsed span detail pane", () => {
    describe("when expandSpanDetail fires", () => {
      it("opens it, and leaves an open one as it is", () => {
        drawerChrome.getState().togglePaneCollapsed("spanDetail");
        drawerChrome.getState().expandSpanDetail();
        expect(drawerChrome.getState().paneState.spanDetail.collapsed).toBe(false);

        const before = drawerChrome.getState().paneState;
        drawerChrome.getState().expandSpanDetail();
        expect(drawerChrome.getState().paneState).toEqual(before);
      });
    });
  });
});

describe("drawer chrome when nothing was remembered", () => {
  it("has no width, so the caller decides on the default", () => {
    expect(drawerChrome.getState().widthPx).toBeNull();
  });
});

describe("drawer chrome toggleMaximized", () => {
  it("toggles the boolean independent of widthPx", () => {
    const before = drawerChrome.getState().isMaximized;
    drawerChrome.getState().toggleMaximized();
    expect(drawerChrome.getState().isMaximized).toBe(!before);
    drawerChrome.getState().toggleMaximized();
    expect(drawerChrome.getState().isMaximized).toBe(before);
  });
});

describe("drawer chrome reset", () => {
  describe("given a drawer that was maximised with the shortcuts help open", () => {
    describe("when the drawer closes", () => {
      it("puts both away and forgets the opening row's span count, keeping the reader's layout", () => {
        drawerChrome.getState().setWidthPx(700);
        drawerChrome.getState().setMaximized(true);
        drawerChrome.getState().setShortcutsOpen(true);
        drawerChrome.getState().expectSpanCount({ traceId: "trace-1", count: 9 });

        drawerChrome.getState().reset();

        expect(drawerChrome.getState()).toMatchObject({
          isMaximized: false,
          shortcutsOpen: false,
          expectedSpan: null,
          widthPx: 700,
        });
      });
    });
  });
});
