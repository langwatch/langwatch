/**
 * @vitest-environment jsdom
 *
 * An empty aggregate says only a department rule starts a member at its join date.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import "@testing-library/jest-dom/vitest";

import { EmptyFilterState } from "../empty-filter-state.tsx";

let projectKind = "aggregate";

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", kind: projectKind } }),
}));

vi.mock("../../../../../features/explorer/behavior/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => ({ instantEval: null }),
}));

vi.mock("../../../../../features/instant-eval/behavior/use-instant-eval-runs.ts", () => ({
  useInstantEvalRuns: () => ({ chips: [] }),
}));

vi.mock("../query-breakdown-chips.tsx", () => ({
  QueryBreakdownChips: () => null,
}));

const NOTE =
  /an aggregate built from a department lists each member's traces from the day that member joined it/i;

function showLastHours(hours: number) {
  const to = 1_791_000_000_000;
  useExplorerStore.getState().setTimeRange({ from: to - hours * 60 * 60 * 1000, to });
}

describe("<EmptyFilterState /> on an empty trace list", () => {
  beforeEach(() => {
    useExplorerStore.getState().clearAll();
    showLastHours(12);
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an aggregate project", () => {
    beforeEach(() => {
      projectKind = "aggregate";
    });

    describe("when ana opens its Trace Explorer", () => {
      /** @scenario "An empty aggregate says only a department rule starts at the join date" */
      it("says only a department aggregate starts at the join date, and older traces stay in the member", () => {
        renderWithDesignSystem(<EmptyFilterState />);

        expect(screen.getByText(NOTE)).toBeInTheDocument();
        expect(screen.getByText(/older traces stay in the member project/i)).toBeInTheDocument();
      });

      /** @scenario "An empty aggregate says only a department rule starts at the join date" */
      it("still offers a wider time window", () => {
        renderWithDesignSystem(<EmptyFilterState />);

        expect(screen.getByRole("button", { name: "Last 24 hours" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Last 7 days" })).toBeInTheDocument();
      });
    });
  });

  describe("given a plain project", () => {
    beforeEach(() => {
      projectKind = "application";
    });

    describe("when its Trace Explorer is empty", () => {
      /** @scenario "An empty aggregate says only a department rule starts at the join date" */
      it("says nothing about aggregates", () => {
        renderWithDesignSystem(<EmptyFilterState />);

        expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Last 24 hours" })).toBeInTheDocument();
      });
    });
  });
});
