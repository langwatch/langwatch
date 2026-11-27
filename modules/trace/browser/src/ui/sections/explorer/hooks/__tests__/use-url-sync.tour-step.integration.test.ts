// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { useFilterStore, useViewStore } from "../../../../../behavior/explorer.store.ts";
import { INITIAL_TIME_RANGE } from "../../../../../behavior/query.slice.ts";
import { ACTIVE_LENS_KEY } from "../../../../../behavior/view.slice.ts";
import { useURLSync } from "../use-url-sync.ts";

const renderURLSync = () => renderHook(() => useURLSync(), { wrapper: BrowserRouter });

/** Past the writer's 150ms debounce. */
async function flushFragmentWrite(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

beforeEach(() => {
  window.localStorage.removeItem(ACTIVE_LENS_KEY);
  useFilterStore.getState().clearAll();
  useFilterStore.setState({
    timeRange: INITIAL_TIME_RANGE,
    debouncedTimeRange: INITIAL_TIME_RANGE,
  });
  useViewStore.setState({ activeLensId: "all-traces", draftState: new Map() });
});

describe("useURLSync with a tour step in the fragment", () => {
  describe("given a reload lands on a deep-linked filter while the tour runs", () => {
    /** @scenario "The bar-state writer keeps the tour step" */
    it("applies the filter and keeps the step through its own writes", async () => {
      window.history.replaceState(
        null,
        "",
        "/traces#all-traces?q=trace.attribute.laze.agent.id%3Aagt_123&sp=search-bar",
      );

      renderURLSync();
      await flushFragmentWrite();

      expect(useFilterStore.getState().queryText).toBe("trace.attribute.laze.agent.id:agt_123");
      expect(window.location.hash).toContain("sp=search-bar");

      act(() => {
        useFilterStore.getState().applyQueryText("status:error");
      });
      await flushFragmentWrite();

      expect(window.location.hash).toContain("q=status%3Aerror");
      expect(window.location.hash).toContain("sp=search-bar");
    });
  });
});
