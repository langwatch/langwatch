/**
 * @vitest-environment jsdom
 *
 * "Judge these results" hands the query, as typed, to the search bar, which
 * starts the pending chip's run the way Enter does. @see ADR-144
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useExplorerStore } from "@langwatch/trace-browser-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useSearchSubmitRequestStore } from "../../../../../behavior/search-submit-request.store.ts";
import { EmptyFilterState } from "../empty-filter-state.tsx";

const QUERY = 'status:error AND eval:"is the user annoyed"';

vi.mock("../../hooks/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => ({ instantEval: null }),
}));

let mockChips: { runId: string | null; question: string }[] = [];
vi.mock("../../hooks/use-instant-eval-runs.ts", () => ({
  useInstantEvalRuns: () => ({ chips: mockChips }),
}));

vi.mock("../query-breakdown-chips.tsx", () => ({
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
    useExplorerStore.getState().clearAll();
    useExplorerStore.getState().applyQueryText(QUERY);
    mockChips = [{ runId: null, question: "is the user annoyed" }];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when Judge these results is clicked", () => {
    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("submits the query as typed through the search bar", () => {
      renderEmptyState();

      fireEvent.click(screen.getByRole("button", { name: "Judge these results" }));

      expect(useSearchSubmitRequestStore.getState().request).toEqual({
        text: QUERY,
        nonce: 1,
      });
    });
  });

  describe("when every chip already has a run", () => {
    it("offers no judge button, since there is nothing left to start", () => {
      mockChips = [{ runId: "run_1", question: "is the user annoyed" }];
      renderEmptyState();

      expect(screen.queryByRole("button", { name: "Judge these results" })).not.toBeInTheDocument();
      expect(useSearchSubmitRequestStore.getState().request).toBeNull();
    });
  });
});
