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
import { beforeEach, describe, expect, it } from "vitest";

import { INITIAL_TIME_RANGE, useFilterStore } from "../../stores/filterStore";
import { useViewStore } from "../../stores/viewStore";
import { useURLSync } from "../useURLSync";

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

beforeEach(() => {
  // `#all-traces` rather than a bare URL: the write-back effect collapses the
  // default lens with no overrides to an empty fragment, and we want a body
  // that stays put for the duration of the test.
  window.history.replaceState(null, "", "/#all-traces");
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
        renderHook(() => useURLSync());
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
        renderHook(() => useURLSync());
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
        // The skip is keyed off a `null` sentinel rather than an empty
        // string precisely so this first apply isn't swallowed: a bare URL
        // has to restore the default/last-used lens and start from page 1.
        window.history.replaceState(null, "", "/");
        seedThirdPage();

        renderHook(() => useURLSync());

        expect(pagination()).toEqual({ page: 1, pageCursors: { 1: null } });
      });
    });

    describe("when popstate fires on a fragment naming a different lens", () => {
      it("applies the lens and drops the cursors", () => {
        window.history.replaceState(null, "", "/#errors");
        renderHook(() => useURLSync());
        act(() => seedThirdPage());

        act(() => {
          window.history.replaceState(null, "", "/#all-traces");
          popState();
        });

        expect(useViewStore.getState().activeLensId).toBe("all-traces");
        expect(pagination()).toEqual({ page: 1, pageCursors: { 1: null } });
      });
    });
  });
});
