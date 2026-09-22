// @vitest-environment jsdom
/**
 * The Explorer store outlives the page, so the selection does too. This file
 * drives the case the page alone cannot see: the user leaves the Explorer,
 * the search changes while it is unmounted (a Langy card's "View in Trace
 * Explorer" link), and the page comes back. The rows that were checked are
 * not the rows the new search lists.
 *
 * See specs/langy/langy-trace-explorer-link.feature.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useExplorerStore } from "../../stores/explorerStore";
import { useResetSelectionOnViewChange } from "../useResetSelectionOnViewChange";

function Page() {
  useResetSelectionOnViewChange();
  return null;
}

/** Whatever the page renders, the reads run off the debounced copy. */
function applySearch(queryText: string) {
  useExplorerStore.setState({ queryText, debouncedQueryText: queryText });
}

const selectedIds = () => [...useExplorerStore.getState().selection.traceIds];

beforeEach(() => {
  useExplorerStore.getState().clearAll();
  useExplorerStore.setState({ selectionViewKey: null });
  useExplorerStore.getState().clearSelection();
});

describe("given rows selected under one search", () => {
  describe("when the page re-renders under the same search", () => {
    it("keeps the selection", () => {
      applySearch("status:error");
      const { rerender } = render(<Page />);
      useExplorerStore.getState().setSelectedMany(["trace-a"], true);

      rerender(<Page />);

      expect(selectedIds()).toEqual(["trace-a"]);
    });
  });

  describe("when the search changes while the page is mounted", () => {
    it("clears the selection", () => {
      applySearch("status:error");
      render(<Page />);
      useExplorerStore.getState().setSelectedMany(["trace-a"], true);

      applySearch("status:ok");
      render(<Page />);

      expect(selectedIds()).toEqual([]);
    });
  });

  describe("when the page is unmounted and comes back on another search", () => {
    /** @scenario "A selection made before leaving the Explorer does not come back with another search" */
    it("clears the selection the earlier search left behind", () => {
      applySearch("status:error");
      const first = render(<Page />);
      useExplorerStore.getState().setSelectedMany(["trace-a", "trace-b"], true);
      first.unmount();

      // The link that opened the Explorer named another filter.
      applySearch("refund");
      render(<Page />);

      expect(selectedIds()).toEqual([]);
      expect(useExplorerStore.getState().selection.mode).toBe("explicit");
    });
  });

  describe("when the page is unmounted and comes back on the same search", () => {
    /** @scenario "Coming back to the same search keeps the selection" */
    it("keeps the selection", () => {
      applySearch("status:error");
      const first = render(<Page />);
      useExplorerStore.getState().setSelectedMany(["trace-a"], true);
      first.unmount();

      render(<Page />);

      expect(selectedIds()).toEqual(["trace-a"]);
    });
  });
});
