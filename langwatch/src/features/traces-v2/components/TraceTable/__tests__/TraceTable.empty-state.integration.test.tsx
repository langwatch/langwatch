/**
 * @vitest-environment jsdom
 *
 * Verifies that EmptyFilterState only renders when the data is truly empty
 * (not fetching, not showing previous-key stale data). During in-flight
 * transitional fetches the lens body renders instead of the empty surface.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// ─── Mutable state for useTraceList mock ──────────────────────────────────────

let mockTraceListResult = {
  data: [] as { traceId: string }[],
  totalHits: 0,
  isLoading: false,
  isFetching: false,
  isPreviousData: false,
  isError: false,
  error: null,
  newIds: new Set<string>(),
};

vi.mock("../../../hooks/useTraceList", () => ({
  useTraceList: () => mockTraceListResult,
}));

// ─── viewStore mock — returns activeLens so TraceTable doesn't bail early ────

vi.mock("../../../stores/viewStore", () => ({
  useViewStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeLensId: "all-traces",
      sort: { columnId: "timestamp", direction: "desc" },
    }),
  getEffectiveLens: (s: { activeLensId: string }) => ({
    id: s.activeLensId,
    label: "All traces",
    grouping: "none",
    columns: [],
  }),
  rowKindForGrouping: (_grouping: string) => "trace",
}));

// ─── Lens body stubs ──────────────────────────────────────────────────────────

vi.mock("../TraceLensBody", () => ({
  TraceLensBody: () => <div data-testid="trace-lens-body">Lens body</div>,
}));

vi.mock("../ConversationLensBody", () => ({
  ConversationLensBody: () => <div data-testid="conversation-lens-body" />,
}));

vi.mock("../GroupLensBody", () => ({
  GroupLensBody: () => <div data-testid="group-lens-body" />,
}));

vi.mock("../EmptyFilterState", () => ({
  EmptyFilterState: () => <div data-testid="empty-filter-state">Nothing matches</div>,
}));

vi.mock("../TraceTableLayout", () => ({
  TraceTableLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="trace-table-layout">{children}</div>
  ),
}));

// ─── Other dependency stubs ───────────────────────────────────────────────────

vi.mock("../../../hooks/useProjectHasTraces", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: true }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../onboarding/store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({ setupDismissedByProject: {}, setSetupDismissedForProject: vi.fn(), reset: vi.fn() }),
}));

vi.mock("../../../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({
      queryText: "",
      timeRange: { from: Date.now() - 3600000, to: Date.now(), label: "Last 1h" },
      clearAll: vi.fn(),
      setTimeRange: vi.fn(),
    }),
}));

vi.mock("../QueryBreakdownChips", () => ({
  QueryBreakdownChips: () => null,
}));

// ─── Module under test ────────────────────────────────────────────────────────

import React from "react";
import { TraceTable } from "../TraceTable";

// ─── Test lifecycle ───────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTraceListResult = {
    data: [],
    totalHits: 0,
    isLoading: false,
    isFetching: false,
    isPreviousData: false,
    isError: false,
    error: null,
    newIds: new Set(),
  };
});

function renderTable() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceTable />
    </ChakraProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<TraceTable /> empty-state gating", () => {
  describe("given data is empty and no fetch is in flight", () => {
    describe("when isFetching=false and isPreviousData=false", () => {
      it("renders EmptyFilterState (true empty)", () => {
        mockTraceListResult = {
          ...mockTraceListResult,
          data: [],
          isFetching: false,
          isPreviousData: false,
        };

        renderTable();

        expect(screen.getByTestId("empty-filter-state")).toBeInTheDocument();
        expect(screen.queryByTestId("trace-lens-body")).not.toBeInTheDocument();
      });
    });
  });

  describe("given data is empty but a fetch is in flight", () => {
    describe("when isFetching=true (transitional fetch for a new query key)", () => {
      it("renders the lens body instead of EmptyFilterState", () => {
        mockTraceListResult = {
          ...mockTraceListResult,
          data: [],
          isFetching: true,
          isPreviousData: false,
        };

        renderTable();

        expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
        expect(screen.getByTestId("trace-lens-body")).toBeInTheDocument();
      });
    });

    describe("when isPreviousData=true (keepPreviousData held stale empty results)", () => {
      it("renders the lens body instead of EmptyFilterState", () => {
        mockTraceListResult = {
          ...mockTraceListResult,
          data: [],
          isFetching: false,
          isPreviousData: true,
        };

        renderTable();

        expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
        expect(screen.getByTestId("trace-lens-body")).toBeInTheDocument();
      });
    });
  });

  describe("given data has rows", () => {
    describe("when traces have arrived", () => {
      it("renders the lens body, not EmptyFilterState", () => {
        mockTraceListResult = {
          ...mockTraceListResult,
          data: [{ traceId: "trace-abc-123" }] as typeof mockTraceListResult.data,
          totalHits: 1,
          isFetching: false,
          isPreviousData: false,
        };

        renderTable();

        expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
        expect(screen.getByTestId("trace-lens-body")).toBeInTheDocument();
      });
    });
  });
});
