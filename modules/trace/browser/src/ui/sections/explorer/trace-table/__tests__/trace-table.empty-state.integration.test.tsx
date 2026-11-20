/**
 * Verifies that EmptyFilterState only renders when the data is truly empty (not
 * fetching, not showing previous-key stale data).
 * @vitest-environment jsdom
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// ─── Mutable state for useTraceList mock ──────────────────────────────────────

let mockTraceListResult = {
  data: [] as { traceId: string }[],
  totalHits: 0,
  isLoading: false,
  isFetching: false,
  isPlaceholderData: false,
  isError: false,
  error: null as unknown,
  newIds: new Set<string>(),
};

vi.mock("../../../../../features/explorer/behavior/use-trace-list.ts", () => ({
  useTraceList: () => mockTraceListResult,
}));

// ─── Mutable state for useSessionGroups mock ──────────────────────────────────

let mockSessionGroupsResult = {
  groups: [] as { conversationId: string }[],
  totalHits: 0,
  nextCursor: null as unknown,
  isLoading: false,
  isFetching: false,
  isPlaceholderData: false,
  isError: false,
  error: null as unknown,
};

vi.mock("../../../../../features/explorer/behavior/use-session-groups.ts", () => ({
  useSessionGroups: () => mockSessionGroupsResult,
  SESSIONS_MAX_PAGE_SIZE: 100,
}));

// ─── viewStore mock — returns activeLens so TraceTable doesn't bail early ────

// Which lens the table renders. The flat grouping walks the trace list, the
// by-conversation grouping walks the session rollups, and both read their
// gating through the same table shell.
let mockGrouping: "flat" | "by-conversation" = "flat";

// The applied query, which the table's "search it as one phrase" fix reads and
// rewrites when the server refused it as too complex.
const mockFilterState = {
  queryText: "",
  // The debounced copy the eval chips are resolved from; no run is registered.
  debouncedQueryText: "",
  debouncedTimeRange: { from: 1_000, to: 2_000 },
  evalRuns: {} as Record<string, string>,
  timeRange: { from: Date.now() - 3600000, to: Date.now(), label: "Last 1h" },
  clearAll: vi.fn(),
  setTimeRange: vi.fn(),
  applyQueryText: vi.fn(),
};

// The page-wide count read, answering from whichever source the active lens
// paginates, the way the real selector does.
vi.mock("../../../../../features/explorer/behavior/use-explorer-counts.ts", () => ({
  useExplorerCounts: () =>
    mockGrouping === "by-conversation"
      ? {
          totalHits: mockSessionGroupsResult.totalHits,
          itemNoun: "conversations",
          pageTraceIds: [],
          isLoading: mockSessionGroupsResult.isLoading,
          isFetching: mockSessionGroupsResult.isFetching,
          isPlaceholderData: mockSessionGroupsResult.isPlaceholderData,
          instantEval: null,
          summary: `${mockSessionGroupsResult.totalHits} conversations`,
        }
      : {
          totalHits: mockTraceListResult.totalHits,
          itemNoun: "traces",
          pageTraceIds: mockTraceListResult.data.map((trace) => trace.traceId),
          isLoading: mockTraceListResult.isLoading,
          isFetching: mockTraceListResult.isFetching,
          isPlaceholderData: mockTraceListResult.isPlaceholderData,
          instantEval: null,
          summary: `${mockTraceListResult.totalHits} traces`,
        },
}));

vi.mock("../../../../../behavior/explorer.store.ts", () => ({
  useViewStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeLensId: "all-traces",
      projectId: "proj-1",
      sort: { columnId: "timestamp", direction: "desc" },
    }),
  useExplorerStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeLensId: "all-traces",
      sort: { columnId: "timestamp", direction: "desc" },
      ...mockFilterState,
    }),
  useEffectiveLens: () => ({
    id: "all-traces",
    label: "All traces",
    grouping: mockGrouping,
    columns: [],
  }),
  useFilterStore: (selector: (s: unknown) => unknown) => selector(mockFilterState),
}));
vi.mock("../../../../../behavior/view.slice.ts", () => ({
  rowKindForGrouping: (grouping: string) =>
    grouping === "by-conversation" ? "conversation" : "trace",
}));

// ─── Lens body stubs ──────────────────────────────────────────────────────────

vi.mock("../trace-lens-body.tsx", () => ({
  TraceLensBody: () => <div data-testid="trace-lens-body">Lens body</div>,
}));

vi.mock("../conversation-lens-body.tsx", () => ({
  ConversationLensBody: () => <div data-testid="conversation-lens-body" />,
}));

vi.mock("../group-lens-body.tsx", () => ({
  GroupLensBody: () => <div data-testid="group-lens-body" />,
}));

vi.mock("../empty-filter-state.tsx", () => ({
  EmptyFilterState: () => <div data-testid="empty-filter-state">Nothing matches</div>,
}));

vi.mock("../trace-table-layout.tsx", () => ({
  TraceTableLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="trace-table-layout">{children}</div>
  ),
}));

// ─── Other dependency stubs ───────────────────────────────────────────────────

vi.mock("../../../../../behavior/explorer/use-project-has-traces.ts", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: true }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../../../behavior/explorer/onboarding/store/onboarding-store.ts", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({
      setupDismissedByProject: {},
      setSetupDismissedForProject: vi.fn(),
      reset: vi.fn(),
    }),
}));

vi.mock("../query-breakdown-chips.tsx", () => ({
  QueryBreakdownChips: () => null,
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { resolveInstantEvalChips } from "@langwatch/trace-contract";
import type React from "react";

import { useInstantEvalRunStore } from "../../../../../features/instant-eval/behavior/instant-eval-run.store.ts";
import { TraceTable } from "../trace-table.tsx";

/** The query's chips, as the table resolves them. */
function chipsOf(queryText: string) {
  return resolveInstantEvalChips({
    queryText,
    lensId: "all-traces",
    window: mockFilterState.debouncedTimeRange,
    runsByKey: {},
  }).chips;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGrouping = "flat";
  mockFilterState.queryText = "";
  mockFilterState.debouncedQueryText = "";
  mockFilterState.evalRuns = {};
  useInstantEvalRunStore.setState({ typedQuestions: {} });
  mockTraceListResult = {
    data: [],
    totalHits: 0,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
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
    isPlaceholderData: false,
    isError: false,
    error: null,
  };
});

function renderTable() {
  return renderWithDesignSystem(<TraceTable />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<TraceTable /> empty-state gating", () => {
  describe("given data is empty and no fetch is in flight", () => {
    describe("when isFetching=false and isPlaceholderData=false", () => {
      it("renders EmptyFilterState (true empty)", () => {
        mockTraceListResult = {
          ...mockTraceListResult,
          data: [],
          isFetching: false,
          isPlaceholderData: false,
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
          isPlaceholderData: false,
        };

        renderTable();

        expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
        expect(screen.getByTestId("trace-lens-body")).toBeInTheDocument();
      });
    });

    describe("when isPlaceholderData=true (keepPreviousData held stale empty results)", () => {
      it("renders the lens body instead of EmptyFilterState", () => {
        mockTraceListResult = {
          ...mockTraceListResult,
          data: [],
          isFetching: false,
          isPlaceholderData: true,
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
          isPlaceholderData: false,
        };

        renderTable();

        expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
        expect(screen.getByTestId("trace-lens-body")).toBeInTheDocument();
      });
    });
  });
});

describe("<TraceTable /> pending NOT eval chip", () => {
  /** @scenario "A pending chip under NOT is not judged yet" */
  it.each([
    ['NOT eval:"the user is annoyed"', "typed", true],
    ['status:error AND NOT eval:"the user is annoyed"', "typed", true],
    ['NOT eval.trace:"the user is annoyed"', "never typed", true],
    ['eval:"the user is annoyed" AND NOT status:error', "typed", false],
    ["NOT eval:my_evaluator", "never typed", false],
  ])(
    "with %s %s here, shows the not-judged state instead of rows: %s",
    (queryText, typed, notJudged) => {
      mockFilterState.debouncedQueryText = queryText;
      if (typed === "typed") {
        for (const { question } of chipsOf(queryText)) {
          useInstantEvalRunStore.getState().markTyped({ projectId: "proj-1", question });
        }
      }
      mockTraceListResult = {
        ...mockTraceListResult,
        data: [{ traceId: "trace-abc-123" }] as typeof mockTraceListResult.data,
        totalHits: 1,
      };

      renderTable();

      expect(screen.queryByTestId("empty-filter-state") !== null).toBe(notJudged);
      expect(screen.queryByTestId("trace-lens-body") !== null).toBe(!notJudged);
    },
  );

  /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
  it("shows a chip a NOT reaches across an OR as not judged, even with its run registered", () => {
    const queryText = 'NOT eval:"the user is annoyed" OR status:error';
    mockFilterState.debouncedQueryText = queryText;
    mockFilterState.evalRuns = Object.fromEntries(
      chipsOf(queryText).map((chip) => [chip.key, "run-1"]),
    );
    mockTraceListResult = {
      ...mockTraceListResult,
      data: [{ traceId: "trace-abc-123" }] as typeof mockTraceListResult.data,
      totalHits: 1,
    };

    renderTable();

    expect(screen.getByTestId("empty-filter-state")).toBeInTheDocument();
  });
});

describe("<TraceTable /> failed-read gating", () => {
  describe("given the server refused the query as too complex", () => {
    /** @scenario "A pending chip under NOT is not judged yet" */
    it("shows the failure and its fix, not the not-judged state, under a pending NOT chip", () => {
      mockFilterState.queryText = 'NOT eval.trace:"the user is annoyed" AND one two three';
      mockFilterState.debouncedQueryText = mockFilterState.queryText;
      mockTraceListResult = {
        ...mockTraceListResult,
        isError: true,
        error: { data: { error: { code: "filter_too_complex", httpStatus: 422 } } },
      };

      renderTable();

      expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Search it as one phrase" })).toBeInTheDocument();
    });

    /** @scenario "A sentence past the term ceiling offers to search it as one phrase" */
    it("offers a one-click fix that requotes the bare words and searches again", () => {
      mockFilterState.queryText =
        "status:error one two three four five six seven eight nine ten eleven";
      mockTraceListResult = {
        ...mockTraceListResult,
        isError: true,
        error: {
          data: {
            error: {
              code: "filter_too_complex",
              httpStatus: 422,
              fault: "customer",
              meta: { maxNodes: 20 },
            },
          },
        },
      };

      renderTable();

      expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Search it as one phrase" }));
      expect(mockFilterState.applyQueryText).toHaveBeenCalledWith(
        'status:error AND "one two three four five six seven eight nine ten eleven"',
      );
    });

    it("offers nothing for a refusal that has no bare words to quote", () => {
      mockFilterState.queryText = "status:error";
      mockTraceListResult = {
        ...mockTraceListResult,
        isError: true,
        error: { data: { error: { code: "filter_too_complex", httpStatus: 422 } } },
      };

      renderTable();

      expect(
        screen.queryByRole("button", { name: "Search it as one phrase" }),
      ).not.toBeInTheDocument();
    });
  });

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

        expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
        expect(screen.getByText(/could not load your traces/i)).toBeInTheDocument();
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

        expect(screen.queryByTestId("empty-filter-state")).not.toBeInTheDocument();
        expect(screen.getByText(/could not load your conversations/i)).toBeInTheDocument();
      });

      it("still shows the empty state when the read genuinely came back empty", () => {
        mockGrouping = "by-conversation";

        renderTable();

        expect(screen.getByTestId("empty-filter-state")).toBeInTheDocument();
      });
    });
  });
});
