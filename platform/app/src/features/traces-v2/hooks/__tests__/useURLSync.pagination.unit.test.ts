// @vitest-environment jsdom
/**
 * Browser Back is the documented gesture for dismissing the trace drawer, and
 * the drawer owns a history entry of its own (its state lives in the query
 * string). `useURLSync` listens on `popstate` for genuine bar-state
 * navigation, so it has to tell the two apart: a Back that only closed the
 * drawer arrives on an unchanged fragment and must leave the table's keyset
 * cursors — and therefore the user's place in the list — alone.
 *
 * See specs/traces-v2/data-layer.feature (URL state) and
 * specs/traces-v2/trace-drawer-shell.feature (drawer dismissal).
 */
import { act, renderHook } from "@testing-library/react";
// `useURLSync` reads React Router's own `useLocation()` now (see the
// push-driven-navigation effect), which throws outside a Router context.
// `BrowserRouter`, not `MemoryRouter`, so it reads the SAME `window.location`
// this file drives directly via `window.history`/`popstate`.
import { BrowserRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { INITIAL_TIME_RANGE, useFilterStore } from "../../stores/filterStore";
import { ACTIVE_LENS_KEY, useViewStore } from "../../stores/viewStore";
import { getPresetById } from "../../utils/timeRangePresets";
import { useURLSync } from "../useURLSync";

const renderURLSync = () =>
  renderHook(() => useURLSync(), { wrapper: BrowserRouter });

const CURSOR_PAGE_2 = { sortValue: 1_700_000_002_000, traceId: "trace-b" };
const CURSOR_PAGE_3 = { sortValue: 1_700_000_001_000, traceId: "trace-c" };

/** Put the store where a user lands after clicking Next twice. */
function seedThirdPage(): void {
  useFilterStore.setState({
    page: 3,
    pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
  });
}

function popState(): void {
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const pagination = () => {
  const { page, pageCursors } = useFilterStore.getState();
  return { page, pageCursors };
};

/** Move the bar off the default window, the way the range picker would. */
function selectSevenDayRange(): void {
  const preset = getPresetById("7d");
  if (!preset) throw new Error("the 7d preset went missing");
  const { from, to } = preset.compute();
  useFilterStore
    .getState()
    .setTimeRange({ from, to, label: preset.label, presetId: preset.id });
}

beforeEach(() => {
  // `#all-traces` rather than a bare URL: the write-back effect collapses the
  // default lens with no overrides to an empty fragment, and we want a body
  // that stays put for the duration of the test.
  window.history.replaceState(null, "", "/#all-traces");
  // The bare-URL branch reads the stored last-used lens, so leaving one behind
  // would make these tests depend on their own execution order.
  window.localStorage.removeItem(ACTIVE_LENS_KEY);
  useFilterStore.getState().clearAll();
  useFilterStore.setState({
    timeRange: INITIAL_TIME_RANGE,
    debouncedTimeRange: INITIAL_TIME_RANGE,
  });
  useViewStore.setState({ activeLensId: "all-traces", draftState: new Map() });
});

describe("useURLSync pagination across browser history navigation", () => {
  describe("given the table is on the third batch of a keyset-paged list", () => {
    describe("when popstate fires on an unchanged fragment (the drawer's own entry)", () => {
      it("keeps the page and its cursors", () => {
        renderURLSync();
        act(() => seedThirdPage());

        act(() => popState());

        expect(pagination()).toEqual({
          page: 3,
          pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
        });
      });
    });

    describe("when popstate fires on a fragment carrying a different query", () => {
      it("applies the fragment and drops the cursors it no longer addresses", () => {
        renderURLSync();
        act(() => seedThirdPage());

        act(() => {
          window.history.replaceState(
            null,
            "",
            "/#all-traces?q=status%3Aerror",
          );
          popState();
        });

        expect(useFilterStore.getState().queryText).toBe("status:error");
        expect(pagination()).toEqual({ page: 1, pageCursors: { 1: null } });
      });
    });

    describe("when the hook mounts on a bare URL carrying no fragment at all", () => {
      it("still applies the fragment — an empty body is not 'already in sync'", () => {
        // The very first apply is unconditional precisely so it isn't
        // swallowed by the in-sync guard: a bare URL still has to restore the
        // default/last-used lens and start from page 1.
        window.history.replaceState(null, "", "/");
        seedThirdPage();

        renderURLSync();

        expect(pagination()).toEqual({ page: 1, pageCursors: { 1: null } });
      });
    });

    describe("when popstate fires on a fragment naming a different lens", () => {
      it("applies the lens and drops the cursors", () => {
        window.history.replaceState(null, "", "/#errors");
        renderURLSync();
        act(() => seedThirdPage());

        act(() => {
          window.history.replaceState(null, "", "/#all-traces");
          popState();
        });

        expect(useViewStore.getState().activeLensId).toBe("all-traces");
        expect(pagination()).toEqual({ page: 1, pageCursors: { 1: null } });
      });
    });

    describe("when Back lands on the drawer's entry, whose body is stale but denotes the same state", () => {
      it("keeps the page and its cursors", () => {
        // The drawer pushes its entry before the write effect has collapsed
        // the default lens to an empty body, so the two strings differ while
        // the bar state they denote is identical. Only the newest entry ever
        // gets rewritten, so this asymmetry is permanent.
        renderURLSync();
        act(() => seedThirdPage());

        act(() => {
          window.history.replaceState(null, "", "/?trace=trace-a");
          popState();
        });

        expect(pagination()).toEqual({
          page: 3,
          pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
        });
      });
    });

    describe("when Back lands on an entry spelling the current state the long way", () => {
      it("keeps the page and its cursors", () => {
        // `#all-traces` and an empty fragment are the same bar state — the
        // writer collapses the default lens with no overrides to `""`.
        window.history.replaceState(null, "", "/");
        renderURLSync();
        act(() => seedThirdPage());

        act(() => {
          window.history.replaceState(null, "", "/#all-traces");
          popState();
        });

        expect(pagination()).toEqual({
          page: 3,
          pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
        });
      });
    });

    describe("when Back lands on an entry from before the time range was changed", () => {
      it("restores the window that entry denotes instead of applying half of it", () => {
        // The full drawer sequence: open + close the drawer (its entries
        // carry the empty body), then move the range to Last 7 days — which
        // only rewrites the CURRENT entry — then page forward and press Back.
        // The entry we land on denotes the default window, so restoring the
        // pagination without restoring the window leaves the user on a range
        // no history entry ever held.
        renderURLSync();
        act(() => {
          window.history.replaceState(null, "", "/#all-traces?preset=7d");
          selectSevenDayRange();
          seedThirdPage();
        });

        act(() => {
          window.history.replaceState(null, "", "/?trace=trace-a");
          popState();
        });

        expect(useFilterStore.getState().timeRange.presetId).toBe("30d");
        expect(pagination()).toEqual({ page: 1, pageCursors: { 1: null } });
      });
    });
  });
});
