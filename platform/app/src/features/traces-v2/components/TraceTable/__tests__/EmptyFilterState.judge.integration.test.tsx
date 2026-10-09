/**
 * @vitest-environment jsdom
 *
 * "Judge these results" under an empty table hands the query, as typed, to
 * the search bar. The bar finds the chip no run has answered and starts its
 * run the way Enter would, so the button and Enter cannot drift apart.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useSearchSubmitRequestStore } from "../../../stores/searchSubmitRequestStore";
import { EmptyFilterState } from "../EmptyFilterState";

const QUERY = 'status:error AND eval:"is the user annoyed"';
const NOW = 1_700_000_000_000;

const explorerState = {
  queryText: QUERY,
  clearAll: vi.fn(),
  timeRange: { from: NOW - 24 * 60 * 60 * 1000, to: NOW },
  setTimeRange: vi.fn(),
  activeLensId: "all-traces",
  selectLens: vi.fn(),
};

vi.mock("../../../stores/explorerStore", () => ({
  useExplorerStore: (selector: (s: typeof explorerState) => unknown) =>
    selector(explorerState),
}));

let mockChips: { runId: string | null }[] = [];
vi.mock("../../../hooks/useInstantEvalRuns", () => ({
  useInstantEvalRuns: () => ({ chips: mockChips }),
}));

const runState = { runs: {}, settled: {} };
vi.mock("../../../stores/instantEvalRunStore", () => ({
  useInstantEvalRunStore: (selector: (s: typeof runState) => unknown) =>
    selector(runState),
}));

vi.mock("../QueryBreakdownChips", () => ({
  QueryBreakdownChips: () => null,
}));

function renderEmptyState() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EmptyFilterState />
    </ChakraProvider>,
  );
}

describe("<EmptyFilterState /> under an eval chip no run has answered", () => {
  beforeEach(() => {
    useSearchSubmitRequestStore.getState().clear();
    mockChips = [{ runId: null }];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when Judge these results is clicked", () => {
    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("submits the query as typed through the search bar", () => {
      renderEmptyState();

      fireEvent.click(
        screen.getByRole("button", { name: "Judge these results" }),
      );

      expect(useSearchSubmitRequestStore.getState().request).toEqual({
        text: QUERY,
        nonce: 1,
      });
    });
  });

  describe("when every chip already has a run", () => {
    it("offers no judge button, since there is nothing left to start", () => {
      mockChips = [{ runId: "run_1" }];
      renderEmptyState();

      expect(
        screen.queryByRole("button", { name: "Judge these results" }),
      ).not.toBeInTheDocument();
      expect(useSearchSubmitRequestStore.getState().request).toBeNull();
    });
  });
});
