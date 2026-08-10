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
  error: null as unknown,
  newIds: new Set<string>(),
};

vi.mock("../../../hooks/useTraceList", () => ({
  useTraceList: () => mockTraceListResult,
}));

// ─── Mutable state for useSessionGroups mock ──────────────────────────────────

let mockSessionGroupsResult = {
  groups: [] as { conversationId: string }[],
  totalHits: 0,
  nextCursor: null as unknown,
  isLoading: false,
  isFetching: false,
  isPreviousData: false,
  isError: false,
  error: null as unknown,
};

vi.mock("../../../hooks/useSessionGroups", () => ({
  useSessionGroups: () => mockSessionGroupsResult,
  SESSIONS_MAX_PAGE_SIZE: 100,
}));

// ─── viewStore mock — returns activeLens so TraceTable doesn't bail early ────

// Which lens the table renders. The flat grouping walks the trace list, the
// by-conversation grouping walks the session rollups, and both read their
// gating through the same table shell.
let mockGrouping: "flat" | "by-conversation" = "flat";

vi.mock("../../../stores/viewStore", () => ({
  useViewStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeLensId: "all-traces",
      sort: { columnId: "timestamp", direction: "desc" },
    }),
  getEffectiveLens: (s: { activeLensId: string }) => ({
    id: s.activeLensId,
    label: "All traces",
    grouping: mockGrouping,
    columns: [],
  }),
  rowKindForGrouping: (grouping: string) =>
    grouping === "by-conversation" ? "conversation" : "trace",
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
  EmptyFilterState: () => (
    <div data-testid="empty-filter-state">Nothing matches</div>
  ),
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
    selector({
      setupDismissedByProject: {},
      setSetupDismissedForProject: vi.fn(),
      reset: vi.fn(),
    }),
}));

vi.mock("../../../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({
      queryText: "",
      timeRange: {
        from: Date.now() - 3600000,
        to: Date.now(),
        label: "Last 1h",
      },
      clearAll: vi.fn(),
      setTimeRange: vi.fn(),
    }),
}));

vi.mock("../QueryBreakdownChips", () => ({
  QueryBreakdownChips: () => null,
}));

// ─── Module under test ────────────────────────────────────────────────────────

import type React from "react";
import { TraceTable } from "../TraceTable";

// ─── Test lifecycle ───────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGrouping = "flat";
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
  mockSessionGroupsResult = {
    groups: [],
    totalHits: 0,
    nextCursor: null,
    isLoading: false,
    isFetching: false,
    isPreviousData: false,
    isError: false,
    error: null,
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

        expect(
          screen.queryByTestId("empty-filter-state"),
        ).not.toBeInTheDocument();
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

        expect(
          screen.queryByTestId("empty-filter-state"),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("trace-lens-body")).toBeInTheDocument();
      });
    });
  });

  describe("given data has rows", () => {
    describe("when traces have arrived", () => {
      it("renders the lens body, not EmptyFilterState", () => {
        mockTraceListResult = {
          ...mockTraceListResult,
          data: [
            { traceId: "trace-abc-123" },
          ] as typeof mockTraceListResult.data,
          totalHits: 1,
          isFetching: false,
          isPreviousData: false,
        };

        renderTable();

        expect(
          screen.queryByTestId("empty-filter-state"),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("trace-lens-body")).toBeInTheDocument();
      });
    });
  });
});

describe("<TraceTable /> failed-read gating", () => {
  describe("given the trace list query failed", () => {
    describe("when the failure leaves no rows behind", () => {
      // The failure mode this pins: a failed read and an empty result are
      // indistinguishable by row count, and reporting the failure as "nothing
      // matched" sends someone to widen a filter that was never the problem.
      /** @scenario A failed session read is not reported as an empty result */
      it("renders the error surface instead of the empty state", () => {
        mockTraceListResult = {
          ...mockTraceListResult,
          data: [],
          totalHits: 0,
          isError: true,
          error: new Error("clickhouse unreachable"),
        };

        renderTable();

        expect(
          screen.queryByTestId("empty-filter-state"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByText(/could not load your traces/i),
        ).toBeInTheDocument();
      });
    });
  });

  // The sessions lens paginates its own server-grouped rows, so the failure it
  // has to report is the session rollup's, not the trace list's. Without this
  // the shell could stop forwarding the sessions query's `isError` entirely and
  // the flat-lens case above would still pass.
  describe("given the session rollup query failed", () => {
    describe("when the by-conversation grouping is active", () => {
      /** @scenario A failed session read is not reported as an empty result */
      it("renders the error surface instead of the empty state", () => {
        mockGrouping = "by-conversation";
        mockSessionGroupsResult = {
          ...mockSessionGroupsResult,
          groups: [],
          totalHits: 0,
          isError: true,
          error: new Error("clickhouse unreachable"),
        };

        renderTable();

        expect(
          screen.queryByTestId("empty-filter-state"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByText(/could not load your conversations/i),
        ).toBeInTheDocument();
      });

      it("still shows the empty state when the read genuinely came back empty", () => {
        mockGrouping = "by-conversation";

        renderTable();

        expect(screen.getByTestId("empty-filter-state")).toBeInTheDocument();
      });
    });
  });
});
