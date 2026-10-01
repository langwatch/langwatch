// @vitest-environment jsdom
/**
 * A submitted search is a place Back can return to: query, window and lens push
 * an entry, while the run keys and a mount's first write rewrite it in place.
 * @see specs/traces-v2/search.feature
 */
import {
  ACTIVE_LENS_KEY,
  INITIAL_TIME_RANGE,
  useExplorerStore,
} from "@langwatch/trace-browser-kit";
import { act, render } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isNewSearchEntry, useURLSync } from "../use-url-sync.ts";

function Mounted() {
  useURLSync();
  return null;
}

function Harness() {
  return (
    <BrowserRouter>
      <Mounted />
    </BrowserRouter>
  );
}

const query = () => useExplorerStore.getState().queryText;

function submit(queryText: string) {
  act(() => useExplorerStore.getState().applyQueryText(queryText));
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

async function goBack() {
  await act(async () => {
    window.history.back();
    await vi.advanceTimersByTimeAsync(50);
  });
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.removeItem(ACTIVE_LENS_KEY);
  useExplorerStore.getState().clearAll();
  useExplorerStore.setState({
    timeRange: INITIAL_TIME_RANGE,
    debouncedTimeRange: INITIAL_TIME_RANGE,
  });
  useExplorerStore.setState({ activeLensId: "all-traces", draftState: new Map() });
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isNewSearchEntry", () => {
  describe("when the page writes its address for the first time", () => {
    it("rewrites the entry the page was opened with", () => {
      expect(isNewSearchEntry({ previousSearch: null, nextSearch: "all?q=a" })).toBe(false);
    });
  });

  describe("when only the run keys moved", () => {
    it("rewrites the entry the submit made", () => {
      expect(isNewSearchEntry({ previousSearch: "all?q=a", nextSearch: "all?q=a" })).toBe(false);
    });
  });

  describe("when the query, the window or the lens moved", () => {
    it("is a new entry", () => {
      expect(isNewSearchEntry({ previousSearch: "all?q=a", nextSearch: "all?q=b" })).toBe(true);
    });
  });
});

describe("useURLSync history", () => {
  describe("given two searches submitted one after the other", () => {
    /** @scenario "Back returns to the search before" */
    it("adds one history entry per search, and Back restores the first", async () => {
      render(<Harness />);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      const entriesAtOpen = window.history.length;

      submit("status:error");
      submit("model:gpt-5-mini");
      expect(window.history.length).toBe(entriesAtOpen + 2);
      expect(window.location.hash).toContain("model%3Agpt-5-mini");

      await goBack();
      expect(query()).toBe("status:error");
      expect(window.location.hash).toContain("status%3Aerror");
      // Restoring an entry is not a new search: nothing is pushed on top.
      expect(window.history.length).toBe(entriesAtOpen + 2);
    });
  });

  describe("given a run registered for the search just submitted", () => {
    /** @scenario "Run progress and run keys never add history entries" */
    it("writes the run key into the same entry", () => {
      render(<Harness />);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      submit('eval:"the user is annoyed"');
      const entries = window.history.length;

      act(() => useExplorerStore.setState({ evalRuns: { "key-1": "run-1" } }));
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(window.history.length).toBe(entries);
      expect(decodeURIComponent(window.location.hash)).toContain("run-1");
    });
  });
});
