/**
 * @vitest-environment jsdom
 *
 * "Judge these results" hands the query, as typed, to the search bar, which
 * starts the pending chip's run the way Enter does. @see ADR-144
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import "@testing-library/jest-dom/vitest";

import { useSearchSubmitRequestStore } from "../../../../../features/explorer/behavior/search-submit-request.store.ts";
import { EmptyFilterState } from "../empty-filter-state.tsx";

const QUERY = 'status:error AND eval:"is the user annoyed"';

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", kind: "application" } }),
}));

vi.mock("../../../../../features/explorer/behavior/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => ({ instantEval: null }),
}));

let mockChips: { runId: string | null; question: string }[] = [];
let mockHasUnjudgeableEval = false;
vi.mock("../../../../../features/instant-eval/behavior/use-instant-eval-runs.ts", () => ({
  useInstantEvalRuns: () => ({ chips: mockChips }),
}));
vi.mock("../../../../../features/instant-eval/behavior/use-has-unjudgeable-eval.ts", () => ({
  useHasUnjudgeableEval: () => mockHasUnjudgeableEval,
}));

vi.mock("../query-breakdown-chips.tsx", () => ({
  QueryBreakdownChips: () => null,
}));

function renderEmptyState() {
  return renderWithDesignSystem(<EmptyFilterState />);
}

describe("<EmptyFilterState /> under an eval chip no run has answered", () => {
  beforeEach(() => {
    useSearchSubmitRequestStore.getState().clear();
    useExplorerStore.getState().clearAll();
    useExplorerStore.getState().applyQueryText(QUERY);
    mockChips = [{ runId: null, question: "is the user annoyed" }];
    mockHasUnjudgeableEval = false;
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

  describe("when a NOT reaches the chip across an OR, so no run can answer it", () => {
    /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
    it("says the NOT must be rewritten and offers no judge button that only ends in a refusal", () => {
      mockHasUnjudgeableEval = true;
      renderEmptyState();

      expect(screen.getByText("This NOT cannot be judged as typed")).toBeInTheDocument();
      expect(screen.getByText(/Rewrite the NOT beside them with AND/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Judge these results" })).not.toBeInTheDocument();
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
