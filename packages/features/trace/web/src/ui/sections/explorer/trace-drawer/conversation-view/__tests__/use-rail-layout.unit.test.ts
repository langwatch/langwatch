/**
 * @vitest-environment jsdom
 *
 * The rail's two decisions, taken away from the DOM: whether the conversation
 * has a rail at all, and what shape it takes at a given pane width. Both are
 * biased towards keeping the annotations beside the turn.
 * See specs/traces-v2/annotation-rail.feature.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isRailActive,
  RAIL_GAP_PX,
  RAIL_WIDTH_SLIM_PX,
  RAIL_WIDTH_WIDE_PX,
  resolveRailLayout,
  THREAD_COLUMN_MAX_WIDTH_PX,
  threadColumnMaxWidth,
  useRailLayout,
} from "../use-rail-layout";

const TURNS = new Set(["trace-1", "trace-2"]);

describe("given a conversation in thread layout", () => {
  /** @scenario "A conversation with no annotations and no open composer has no rail" */
  it("has no rail when nothing is annotated and nothing is being written", () => {
    expect(
      isRailActive({
        layout: "thread",
        hasAnnotations: false,
        draftTraceId: null,
        turnTraceIds: TURNS,
      }),
    ).toBe(false);
  });

  /** @scenario "Starting an annotation on a turn opens the rail" */
  it("opens the rail once one of its turns is being annotated", () => {
    expect(
      isRailActive({
        layout: "thread",
        hasAnnotations: false,
        draftTraceId: "trace-2",
        turnTraceIds: TURNS,
      }),
    ).toBe(true);
  });

  /** @scenario "An annotation on any turn opens the rail for the whole conversation" */
  it("opens the rail when any turn already carries an annotation", () => {
    expect(
      isRailActive({
        layout: "thread",
        hasAnnotations: true,
        draftTraceId: null,
        turnTraceIds: TURNS,
      }),
    ).toBe(true);
  });

  /** @scenario "A composer opened on another conversation leaves this rail closed" */
  it("stays closed when the composer belongs to another conversation", () => {
    expect(
      isRailActive({
        layout: "thread",
        hasAnnotations: false,
        draftTraceId: "trace-from-elsewhere",
        turnTraceIds: TURNS,
      }),
    ).toBe(false);
  });
});

describe("given a conversation in bubbles layout", () => {
  /** @scenario "Bubbles layout has the rail as well" */
  it("opens the rail when its turns carry annotations", () => {
    expect(
      isRailActive({
        layout: "bubbles",
        hasAnnotations: true,
        draftTraceId: null,
        turnTraceIds: TURNS,
      }),
    ).toBe(true);
  });

  /** @scenario "Bubbles layout has the rail as well" */
  it("opens the rail once one of its turns is being annotated", () => {
    expect(
      isRailActive({
        layout: "bubbles",
        hasAnnotations: false,
        draftTraceId: "trace-1",
        turnTraceIds: TURNS,
      }),
    ).toBe(true);
  });
});

describe("given a conversation rendered as markdown", () => {
  /** @scenario "The markdown layout has no rail" */
  it("opens no rail even when its turns carry annotations", () => {
    expect(
      isRailActive({
        layout: "markdown",
        hasAnnotations: true,
        draftTraceId: "trace-1",
        turnTraceIds: TURNS,
      }),
    ).toBe(false);
  });
});

describe("given a conversation pane of a given width", () => {
  describe("when the pane is wide", () => {
    /** @scenario "A wide conversation pane gives the rail its full width" */
    it("puts the rail beside the turn at its full width", () => {
      expect(resolveRailLayout(1200)).toEqual({
        mode: "side",
        railWidth: RAIL_WIDTH_WIDE_PX,
      });
    });
  });

  describe("when the pane narrows", () => {
    /** @scenario "A narrowing pane slims the rail before moving it" */
    it("slims the rail but keeps it beside the turn", () => {
      expect(resolveRailLayout(720)).toEqual({
        mode: "side",
        railWidth: RAIL_WIDTH_SLIM_PX,
      });
    });
  });

  describe("when the pane is too narrow for two columns", () => {
    /** @scenario "A pane too narrow for two columns stacks the rail under the turn" */
    it("stacks the rail under the turn", () => {
      expect(resolveRailLayout(560).mode).toBe("stacked");
    });
  });

  describe("when nothing has been measured yet", () => {
    it("assumes the wide layout", () => {
      expect(resolveRailLayout(0)).toEqual({
        mode: "side",
        railWidth: RAIL_WIDTH_WIDE_PX,
      });
    });
  });
});

describe("given the centered reading column", () => {
  it("reserves no room for a rail that is closed", () => {
    expect(
      threadColumnMaxWidth({
        isActive: false,
        layout: { mode: "side", railWidth: RAIL_WIDTH_WIDE_PX },
      }),
    ).toBe(`${THREAD_COLUMN_MAX_WIDTH_PX}px`);
  });

  it("grows to carry the rail beside the turn", () => {
    expect(
      threadColumnMaxWidth({
        isActive: true,
        layout: { mode: "side", railWidth: RAIL_WIDTH_WIDE_PX },
      }),
    ).toBe(`${THREAD_COLUMN_MAX_WIDTH_PX + RAIL_GAP_PX + RAIL_WIDTH_WIDE_PX}px`);
  });

  it("keeps the reading width when the rail is stacked under the turn", () => {
    expect(
      threadColumnMaxWidth({
        isActive: true,
        layout: { mode: "stacked", railWidth: RAIL_WIDTH_SLIM_PX },
      }),
    ).toBe(`${THREAD_COLUMN_MAX_WIDTH_PX}px`);
  });
});

/** A ResizeObserver that does nothing but exist, since jsdom has none. */
class InertResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** A scroll container that reports the pane width the test cares about. */
function scrollerOfWidth(width: number): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => ({ width }) as DOMRect;
  return element;
}

describe("given a conversation whose scroller arrives after the first render", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    globalThis.ResizeObserver = InertResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  /** @scenario "A pane too narrow for two columns stacks the rail under the turn" */
  it("measures it as soon as it is attached", async () => {
    const { result } = renderHook(() => useRailLayout());

    expect(result.current.layout).toEqual({
      mode: "side",
      railWidth: RAIL_WIDTH_WIDE_PX,
    });

    act(() => {
      result.current.setScroller(scrollerOfWidth(560));
    });

    await waitFor(() => expect(result.current.layout.mode).toBe("stacked"));
  });

  /** @scenario "A narrowing pane slims the rail before moving it" */
  it("re-measures when a different scroller takes its place", async () => {
    const { result } = renderHook(() => useRailLayout());

    act(() => {
      result.current.setScroller(scrollerOfWidth(560));
    });
    await waitFor(() => expect(result.current.layout.mode).toBe("stacked"));

    act(() => {
      result.current.setScroller(scrollerOfWidth(720));
    });

    await waitFor(() =>
      expect(result.current.layout).toEqual({
        mode: "side",
        railWidth: RAIL_WIDTH_SLIM_PX,
      }),
    );
  });
});
