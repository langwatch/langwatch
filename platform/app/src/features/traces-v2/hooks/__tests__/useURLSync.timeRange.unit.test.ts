// @vitest-environment jsdom
/**
 * The time range is the widest-reaching axis the fragment carries — every
 * query on the page is scoped by it — and it is the one axis where "the URL
 * said nothing" and "the URL said use the default" are different statements.
 *
 * Inside a fragment they are the same: the writer omits `preset` exactly when
 * it equals the default, so `#errors` positively denotes the default window
 * (pinned by `useURLSync.pagination.unit.test.ts`, where Back onto an entry
 * predating a range change has to restore the window that entry denotes). A
 * URL with no fragment at all is that statement only on `popstate`; on arrival
 * it is just where the user landed.
 *
 * See specs/traces-v2/data-layer.feature (URL state) and
 * specs/traces-v2/search.feature (time range selector).
 */
import { act, renderHook } from "@testing-library/react";
// `useURLSync` reads React Router's own `useLocation()` now (see the
// push-driven-navigation effect), which throws outside a Router context.
// `BrowserRouter`, not `MemoryRouter`, so it reads the SAME `window.location`
// this file drives directly via `window.history`/`popstate`.
import { BrowserRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ACTIVE_LENS_KEY,
  getPresetById,
  INITIAL_TIME_RANGE,
  useFilterStore,
  useViewStore,
} from "@langwatch/trace-web";
import { useURLSync } from "../useURLSync";

const renderURLSync = () => renderHook(() => useURLSync(), { wrapper: BrowserRouter });

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

function computePreset(id: string): { from: number; to: number } {
  const preset = getPresetById(id);
  if (!preset) throw new Error(`the ${id} preset went missing`);
  return preset.compute();
}

/** Move the bar off the default window, the way the range picker would. */
function selectPreset(id: string): void {
  const preset = getPresetById(id);
  if (!preset) throw new Error(`the ${id} preset went missing`);
  const { from, to } = preset.compute();
  useFilterStore
    .getState()
    .setTimeRange({ from, to, label: preset.label, presetId: preset.id });
}

/**
 * Store a window the way `TimeRangePicker.applyAbsolute` does: `{from, to}`
 * and NO preset id. The instants here line up with a rolling preset, which is
 * the common case rather than a contrived one — the absolute inputs are
 * prefilled from the current range, so pressing Apply after editing only one
 * end lands well inside the preset's match tolerance.
 */
function pinAbsoluteWindow(range: { from: number; to: number }): void {
  useFilterStore.getState().setTimeRange(range);
}

beforeEach(() => {
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

describe("useURLSync time range on arrival", () => {
  describe("given the user chose a non-default window earlier in the session", () => {
    describe("when the hook mounts on a bare URL carrying no fragment", () => {
      it("leaves the chosen window in place", () => {
        // Clicking "Observe" in the sidebar is a bare link, and the stores are
        // module-level, so this is every in-app return to the page. The URL
        // says nothing about time; forcing the default here silently widened
        // the user's window — and every query behind it — by 30x.
        window.history.replaceState(null, "", "/");
        selectPreset("24h");

        renderURLSync();

        expect(useFilterStore.getState().timeRange.presetId).toBe("24h");
      });
    });
  });
});

describe("useURLSync time range across browser history navigation", () => {
  describe("given the user pinned an absolute window and paged forward", () => {
    describe("when Back lands on the drawer's own entry", () => {
      it("keeps the page, its cursors and the pinned window", () => {
        // The entry carries the same fragment the writer emitted for the
        // absolute range, so it denotes the state the store already holds:
        // there is nothing to apply. Reading `from`/`to` back as the preset
        // they happen to align with made the two sides spell the same state
        // differently, and the guard could only conclude "this is a real
        // navigation" — costing the user their page AND converting their
        // pinned window into a rolling one.
        const { from, to } = computePreset("24h");
        const body = `#all-traces?from=${from}&to=${to}`;

        renderURLSync();
        act(() => {
          pinAbsoluteWindow({ from, to });
          window.history.replaceState(null, "", `/${body}`);
          seedThirdPage();
        });

        act(() => {
          window.history.replaceState(null, "", `/?trace=trace-a${body}`);
          popState();
        });

        expect(pagination()).toEqual({
          page: 3,
          pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
        });
        expect(useFilterStore.getState().timeRange).toEqual({ from, to });
      });
    });

    describe("when Back lands on an entry naming a preset", () => {
      it("restores the preset that entry denotes", () => {
        const { from, to } = computePreset("24h");

        renderURLSync();
        act(() => {
          pinAbsoluteWindow({ from, to });
          window.history.replaceState(null, "", `/#all-traces?from=${from}&to=${to}`);
          seedThirdPage();
        });

        act(() => {
          window.history.replaceState(null, "", "/#all-traces?preset=7d");
          popState();
        });

        expect(useFilterStore.getState().timeRange.presetId).toBe("7d");
        expect(pagination()).toEqual({ page: 1, pageCursors: { 1: null } });
      });
    });
  });
});
