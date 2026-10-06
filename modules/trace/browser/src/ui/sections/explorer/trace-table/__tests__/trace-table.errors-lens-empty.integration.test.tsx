/**
 * @vitest-environment jsdom
 *
 * A lens preset with nothing to list says so inside the table area.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { TraceTable } from "../trace-table.tsx";

vi.mock("../../hooks/use-trace-list.ts", () => ({
  useTraceList: () => ({
    data: [],
    totalHits: 0,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    error: null,
    newIds: new Set<string>(),
  }),
}));
vi.mock("../../hooks/use-session-groups.ts", () => ({
  useSessionGroups: () => ({
    groups: [],
    totalHits: 0,
    nextCursor: null,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    error: null,
  }),
  SESSIONS_MAX_PAGE_SIZE: 100,
}));
vi.mock("../../hooks/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => ({
    totalHits: 0,
    itemNoun: "traces",
    pageTraceIds: [],
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    instantEval: null,
    summary: "0 traces",
  }),
}));
vi.mock("../../hooks/use-instant-eval-runs.ts", () => ({
  useInstantEvalRuns: () => ({ chips: [] }),
}));
vi.mock("../trace-lens-body.tsx", () => ({
  TraceLensBody: () => <div data-testid="trace-lens-body" />,
}));
vi.mock("../query-breakdown-chips.tsx", () => ({ QueryBreakdownChips: () => null }));
vi.mock("../trace-table-layout.tsx", () => ({
  TraceTableLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="trace-table-layout">{children}</div>
  ),
}));
vi.mock("../../../../../behavior/explorer/use-project-has-traces.ts", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: true }),
}));
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

import type React from "react";

beforeEach(() => {
  useExplorerStore.getState().clearAll();
});

afterEach(() => cleanup());

describe("<TraceTable /> under a lens preset with no matching data", () => {
  describe("given the project has traces but none with errors", () => {
    /** @scenario Lens preset has no matching data */
    it("shows the Errors empty state inside the table area", () => {
      useExplorerStore.getState().selectLens("errors");

      const { container } = renderWithDesignSystem(<TraceTable />);

      expect(within(container).getByText("No errors here, lucky you")).toBeInTheDocument();
      expect(screen.queryByTestId("trace-lens-body")).not.toBeInTheDocument();
      expect(screen.queryByTestId("trace-table-layout")).not.toBeInTheDocument();
    });
  });
});
