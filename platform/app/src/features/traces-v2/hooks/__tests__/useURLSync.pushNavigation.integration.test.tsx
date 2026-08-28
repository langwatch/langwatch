// @vitest-environment jsdom
/**
 * A deep link such as Langy's "View in Trace Explorer" button navigates with
 * `router.push(href)` to this page's OWN route — same-route, fragment-only,
 * mediated by React Router's `navigate()`, never by `popstate`. Every other
 * `useURLSync` test file drives the mount path or the native `popstate`
 * listener; this one drives the third trigger, the one a same-route push
 * needs and neither of the other two covers.
 *
 * `BrowserRouter`, not `MemoryRouter`: `useURLSync` reads the fragment via
 * `window.location.hash` directly, and only `BrowserRouter` keeps that in
 * sync with what `navigate()` pushes — a `MemoryRouter`'s history never
 * touches the real `window.location` at all.
 *
 * See specs/langy/langy-trace-explorer-link.feature.
 */
import { act, render } from "@testing-library/react";
import { BrowserRouter, useNavigate } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ACTIVE_LENS_KEY,
  INITIAL_TIME_RANGE,
  useFilterStore,
  useViewStore,
} from "@langwatch/trace-web";
import { useURLSync } from "../useURLSync";

let pushHash: ((hash: string) => void) | null = null;

function Harness() {
  return (
    <BrowserRouter>
      <Mounted />
    </BrowserRouter>
  );
}

function Mounted() {
  useURLSync();
  const navigate = useNavigate();
  pushHash = (hash: string) =>
    navigate(`${window.location.pathname}${hash}`, { replace: false });
  return null;
}

const barState = () => {
  const { queryText, timeRange } = useFilterStore.getState();
  return { queryText, presetId: timeRange.presetId };
};

beforeEach(() => {
  pushHash = null;
  window.localStorage.removeItem(ACTIVE_LENS_KEY);
  useFilterStore.getState().clearAll();
  useFilterStore.setState({
    timeRange: INITIAL_TIME_RANGE,
    debouncedTimeRange: INITIAL_TIME_RANGE,
  });
  useViewStore.setState({ activeLensId: "all-traces", draftState: new Map() });
  window.history.replaceState(null, "", "/");
});

describe("useURLSync applying a same-route push while already mounted", () => {
  describe("given the hook already applied its bare-URL mount state", () => {
    describe("when a same-route push carries a new query and window", () => {
      /** @scenario Following the link while I am already looking at traces */
      it("applies the pushed query and window instead of leaving the store untouched", () => {
        render(<Harness />);
        expect(barState()).toEqual({ queryText: "", presetId: "30d" });

        act(() => pushHash!("#all-traces?q=%22checkout%22&preset=24h"));

        expect(barState()).toEqual({
          queryText: '"checkout"',
          presetId: "24h",
        });
      });
    });
  });

  describe("given the URL already carries a fragment on arrival", () => {
    /** @scenario Following the link from somewhere else in the project */
    it("applies it on mount, the same query and window a same-route push would carry", () => {
      window.history.replaceState(null, "", "/#all-traces?q=%22checkout%22&preset=24h");

      render(<Harness />);

      expect(barState()).toEqual({ queryText: '"checkout"', presetId: "24h" });
    });
  });

  describe("given the writer moved the fragment behind React Router's back", () => {
    /** @scenario Following the link while I am already looking at traces */
    it("still applies a push to the fragment the router thinks it is already on", async () => {
      // The write effect moves the fragment with a raw `history.replaceState`,
      // which React Router never sees — so its own `location.hash` goes stale
      // as soon as the user edits a filter. A guard comparing that stale copy
      // reads "unchanged" for a push back to the original fragment and drops
      // it, which is exactly the dead button this file exists to pin.
      window.history.replaceState(null, "", "/#all-traces?q=%22first%22");
      render(<Harness />);
      expect(barState().queryText).toBe('"first"');

      // The user edits the query: the store moves and the writer rewrites the
      // fragment, but React Router's location still reads `q="first"`.
      await act(async () => {
        useFilterStore.getState().applyQueryText('"second"');
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(window.location.hash).toContain("second");

      // Now follow a link back to the ORIGINAL fragment. To React Router this
      // is a no-op navigation; to the page it is a real one.
      act(() => pushHash!("#all-traces?q=%22first%22"));

      expect(barState().queryText).toBe('"first"');
    });
  });

  describe("given a same-route push just applied a new bar state", () => {
    /** @scenario The link survives long enough to be read */
    it("is not replaced by the write-back effect a moment later", async () => {
      render(<Harness />);

      act(() => pushHash!("#all-traces?q=%22checkout%22&preset=24h"));
      // Past the write effect's 150ms debounce: if the store had reverted to
      // what it held before the push, the writer would have already spelled
      // that reversion out to the URL by now.
      await act(() => new Promise((resolve) => setTimeout(resolve, 300)));

      expect(barState()).toEqual({ queryText: '"checkout"', presetId: "24h" });
      // Both halves of the address, not just the query: a writer that dropped
      // `preset=24h` would leave the store correct here while handing the next
      // reader of this link the Explorer's 30-day default instead of the
      // window the search actually covered.
      const fragment = new URLSearchParams(
        window.location.hash.slice(window.location.hash.indexOf("?") + 1),
      );
      expect(fragment.get("q")).toBe('"checkout"');
      expect(fragment.get("preset")).toBe("24h");
    });
  });
});
