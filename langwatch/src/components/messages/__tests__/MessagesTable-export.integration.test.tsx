/**
 * @vitest-environment jsdom
 *
 * Integration tests for export flow wiring in MessagesTable.
 *
 * Tests that clicking export buttons opens the ExportConfigDialog,
 * that the dialog receives the correct props (trace count, selection state),
 * and that confirming calls startExport with filters.
 *
 * @see specs/traces/trace-export.feature — "Export Config Dialog", "Filters and Scope"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Hoisted stable mocks ----
// Stable references prevent infinite re-render loops in useEffect deps

const {
  mockOpenExportDialog,
  mockCloseExportDialog,
  mockStartExport,
  mockCancelExport,
  mockUseExportTraces,
  stableSetFn,
  stableTraceGroupsResult,
  stableTopicsResult,
} = vi.hoisted(() => {
  const mockOpenExportDialog = vi.fn();
  const mockCloseExportDialog = vi.fn();
  const mockStartExport = vi.fn();
  const mockCancelExport = vi.fn();
  const stableSetFn = () => {};
  const stableRefetch = () => Promise.resolve();

  const stableTraceGroupsResult = {
    data: {
      groups: [
        [
          {
            trace_id: "trace-1",
            timestamps: { started_at: Date.now() - 60_000 },
            input: { value: "hello" },
            output: { value: "world" },
            metadata: { labels: [] },
            metrics: {},
          },
          {
            trace_id: "trace-2",
            timestamps: { started_at: Date.now() - 120_000 },
            input: { value: "foo" },
            output: { value: "bar" },
            metadata: { labels: [] },
            metrics: {},
          },
        ],
      ],
      traceChecks: {},
      totalHits: 42,
    },
    isLoading: false,
    isRefetching: false,
    isFetched: true,
    isFetching: false,
    refetch: stableRefetch,
  };

  const stableTopicsResult = { data: [] };

  const mockUseExportTraces = vi.fn(() => ({
    isDialogOpen: false,
    openExportDialog: mockOpenExportDialog,
    closeExportDialog: mockCloseExportDialog,
    isExporting: false,
    progress: { exported: 0, total: 0 },
    startExport: mockStartExport,
    cancelExport: mockCancelExport,
  }));

  return {
    mockOpenExportDialog,
    mockCloseExportDialog,
    mockStartExport,
    mockCancelExport,
    mockUseExportTraces,
    stableSetFn,
    stableTraceGroupsResult,
    stableTopicsResult,
  };
});

// ---- Module mocks ----

vi.mock("../useExportTraces", () => ({
  useExportTraces: mockUseExportTraces,
}));

vi.mock("../ExportConfigDialog", () => ({
  ExportConfigDialog: (props: Record<string, unknown>) => {
    if (!props.isOpen) return null;
    return (
      <div data-testid="export-config-dialog">
        <span data-testid="dialog-trace-count">{String(props.traceCount)}</span>
        <span data-testid="dialog-is-selected">
          {String(props.isSelectedExport)}
        </span>
        <button
          data-testid="dialog-export-btn"
          onClick={() =>
            (
              props.onExport as (config: {
                mode: string;
                format: string;
              }) => void
            )({ mode: "summary", format: "csv" })
          }
        >
          Export
        </button>
      </div>
    );
  },
}));

vi.mock("../ExportProgress", () => ({
  ExportProgress: (props: Record<string, unknown>) => {
    if (!props.isExporting) return null;
    return (
      <div data-testid="export-progress">
        Exported {String(props.exported)} of {String(props.total)} traces...
      </div>
    );
  },
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/[project]/messages",
    asPath: "/test/messages",
    push: stableSetFn,
    replace: stableSetFn,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: stableSetFn }),
}));

vi.mock("~/hooks/useBufferedTraceData", () => ({
  useBufferedTraceData: () => ({
    displayData: stableTraceGroupsResult.data,
    pendingData: null,
    pendingCount: 0,
    highlightIds: new Set(),
    acceptPending: stableSetFn,
    mouseLeftAtRef: { current: 0 },
    bypassBufferRef: { current: false },
    displayDataRef: { current: null },
    addPendingCount: stableSetFn,
    reset: stableSetFn,
  }),
}));

vi.mock("~/hooks/useTraceUpdateListener", () => ({
  useTraceUpdateListener: stableSetFn,
}));

vi.mock("~/server/tracer/types.generated", () => ({
  reservedTraceMetadataSchema: {},
}));

vi.mock("~/server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {},
}));

vi.mock("~/server/evaluations/getEvaluator", () => ({
  getEvaluatorDefinitions: () => ({}),
}));

vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({
    filterParams: {
      projectId: "proj-1",
      startDate: 1710500000000,
      endDate: 1710600000000,
      filters: { "metadata.labels": ["production"] },
    },
    queryOpts: { enabled: true },
    filters: { "metadata.labels": ["production"] },
    nonEmptyFilters: { "metadata.labels": ["production"] },
    filterCount: 1,
    hasAnyFilters: true,
    setFilter: stableSetFn,
    setFilters: stableSetFn,
    clearFilters: stableSetFn,
    getLatestFilters: stableSetFn,
    setNegateFilters: stableSetFn,
  }),
}));

vi.mock("~/hooks/useMinimumSpinDuration", () => ({
  useMinimumSpinDuration: () => false,
}));

vi.mock("~/utils/api", () => ({
  api: {
    traces: {
      getAllForProject: {
        useQuery: () => stableTraceGroupsResult,
      },
    },
    topics: { getAll: { useQuery: () => stableTopicsResult } },
    annotation: {
      createQueueItem: {
        useMutation: () => ({ mutate: stableSetFn, isLoading: false }),
      },
    },
    project: {
      getFieldRedactionStatus: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
    useContext: () => ({
      annotation: {
        getPendingItemsCount: { invalidate: stableSetFn },
        getAssignedItemsCount: { invalidate: stableSetFn },
        getQueueItemsCounts: { invalidate: stableSetFn },
      },
    }),
  },
}));

vi.mock("~/components/PeriodSelector", () => ({
  PeriodSelector: () => null,
  usePeriodSelector: () => ({
    period: { startDate: new Date(1710500000000), endDate: new Date(1710600000000) },
    setPeriod: stableSetFn,
  }),
}));

vi.mock("~/components/NavigationFooter", () => ({
  NavigationFooter: () => null,
  useNavigationFooter: () => ({
    pageOffset: 0,
    pageSize: 50,
    totalHits: 42,
    cursorPageNumber: 0,
    useUpdateTotalHits: stableSetFn,
  }),
}));

vi.mock("~/components/filters/FilterSidebar", () => ({
  FilterSidebar: () => null,
}));

vi.mock("~/components/filters/FilterToggle", () => ({
  FilterToggle: () => null,
  useFilterToggle: () => ({ showFilters: false }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: stableSetFn },
}));

vi.mock("usehooks-ts", () => ({
  useLocalStorage: (_k: string, d: unknown) => [d, stableSetFn],
}));

vi.mock("~/utils/getSingleQueryParam", () => ({
  getSingleQueryParam: () => undefined,
}));

vi.mock("~/components/AddAnnotationQueueDrawer", () => ({
  AddAnnotationQueueDrawer: () => null,
}));

vi.mock("~/components/traces/AddParticipants", () => ({
  AddParticipants: () => null,
}));

vi.mock("~/components/checks/EvaluationStatus", () => ({
  evaluationStatusColor: () => "",
}));

vi.mock("~/components/traces/EvaluationStatusItem", () => ({
  formatEvaluationSingleValue: () => "",
}));

vi.mock("~/components/Delayed", () => ({
  Delayed: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/HoverableBigText", () => ({
  HoverableBigText: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("~/components/OverflownText", () => ({
  OverflownTextWithTooltip: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("~/components/ui/RedactedField", () => ({
  RedactedField: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("~/components/ui/layouts/PageLayout", () => {
  const Header = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Heading = ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  );
  const HeaderButton = ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [k: string]: unknown;
  }) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  );
  return {
    PageLayout: Object.assign(() => null, {
      Header,
      Heading,
      HeaderButton,
    }),
  };
});

vi.mock("~/utils/durationColor", () => ({ durationColor: () => "" }));
vi.mock("~/utils/stringifyIfObject", () => ({
  stringifyIfObject: (v: unknown) => String(v ?? ""),
}));
vi.mock("~/utils/originColors", () => ({
  getOriginColor: () => ({ background: "", color: "" }),
  getOriginLabel: (v: string) => v,
}));
vi.mock("~/utils/rotatingColors", () => ({
  getColorForString: () => ({ background: "", color: "" }),
}));
vi.mock("~/utils/stringCasing", () => ({ titleCase: (v: string) => v }));
vi.mock("../HeaderButtons", () => ({
  ToggleTableView: () => null,
  ToggleAnalytics: () => null,
}));
vi.mock("../MessageCard", () => ({}));

// ---- Component under test ----

import { MessagesTable } from "../MessagesTable";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<MessagesTable/> export wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseExportTraces.mockReturnValue({
      isDialogOpen: false,
      openExportDialog: mockOpenExportDialog,
      closeExportDialog: mockCloseExportDialog,
      isExporting: false,
      progress: { exported: 0, total: 0 },
      startExport: mockStartExport,
      cancelExport: mockCancelExport,
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when 'Export all' button is clicked", () => {
    it("calls openExportDialog without selectedTraceIds", async () => {
      const user = userEvent.setup();
      render(<MessagesTable />, { wrapper: Wrapper });

      const exportButton = screen.getByRole("button", { name: /Export all/i });
      await user.click(exportButton);

      expect(mockOpenExportDialog).toHaveBeenCalledWith({});
    });
  });

  describe("when useExportTraces is initialized", () => {
    it("passes projectId and filter params to the hook", () => {
      render(<MessagesTable />, { wrapper: Wrapper });

      expect(mockUseExportTraces).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          filters: { "metadata.labels": ["production"] },
          startDate: 1710500000000,
          endDate: 1710600000000,
        })
      );
    });
  });

  describe("when dialog is open", () => {
    it("renders ExportConfigDialog with total trace count", () => {
      mockUseExportTraces.mockReturnValue({
        isDialogOpen: true,
        openExportDialog: mockOpenExportDialog,
        closeExportDialog: mockCloseExportDialog,
        isExporting: false,
        progress: { exported: 0, total: 0 },
        startExport: mockStartExport,
        cancelExport: mockCancelExport,
      });

      render(<MessagesTable />, { wrapper: Wrapper });

      expect(screen.getByTestId("export-config-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("dialog-trace-count").textContent).toBe("42");
    });

    it("passes isSelectedExport=false when no traces are selected", () => {
      mockUseExportTraces.mockReturnValue({
        isDialogOpen: true,
        openExportDialog: mockOpenExportDialog,
        closeExportDialog: mockCloseExportDialog,
        isExporting: false,
        progress: { exported: 0, total: 0 },
        startExport: mockStartExport,
        cancelExport: mockCancelExport,
      });

      render(<MessagesTable />, { wrapper: Wrapper });

      expect(screen.getByTestId("dialog-is-selected").textContent).toBe(
        "false"
      );
    });
  });

  describe("when user confirms export from dialog", () => {
    it("calls startExport with the selected config", async () => {
      const user = userEvent.setup();
      mockUseExportTraces.mockReturnValue({
        isDialogOpen: true,
        openExportDialog: mockOpenExportDialog,
        closeExportDialog: mockCloseExportDialog,
        isExporting: false,
        progress: { exported: 0, total: 0 },
        startExport: mockStartExport,
        cancelExport: mockCancelExport,
      });

      render(<MessagesTable />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("dialog-export-btn"));

      expect(mockStartExport).toHaveBeenCalledWith({
        mode: "summary",
        format: "csv",
      });
    });
  });

  describe("when export is in progress", () => {
    it("renders ExportProgress with current progress", () => {
      mockUseExportTraces.mockReturnValue({
        isDialogOpen: false,
        openExportDialog: mockOpenExportDialog,
        closeExportDialog: mockCloseExportDialog,
        isExporting: true,
        progress: { exported: 150, total: 500 },
        startExport: mockStartExport,
        cancelExport: mockCancelExport,
      });

      render(<MessagesTable />, { wrapper: Wrapper });

      expect(screen.getByTestId("export-progress")).toBeInTheDocument();
      expect(screen.getByTestId("export-progress").textContent).toContain(
        "Exported 150 of 500 traces..."
      );
    });
  });

  describe("when traces are selected and floating toolbar Export is clicked", () => {
    it("calls openExportDialog with selectedTraceIds", async () => {
      const user = userEvent.setup();
      render(<MessagesTable />, { wrapper: Wrapper });

      // Select trace-1 by clicking its checkbox (index 1, after "select all")
      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[1]!);

      // Find the floating toolbar Export button (not "Export all")
      const allExportButtons = screen.getAllByRole("button", {
        name: /^Export$/i,
      });
      const toolbarExport = allExportButtons.find(
        (btn) => btn.textContent?.trim() === "Export"
      );

      expect(toolbarExport).toBeDefined();
      await user.click(toolbarExport!);

      expect(mockOpenExportDialog).toHaveBeenCalledWith({
        selectedTraceIds: ["trace-1"],
      });
    });
  });

  describe("when hideExport is true", () => {
    it("does not render the Export all button", () => {
      render(<MessagesTable hideExport />, { wrapper: Wrapper });

      expect(
        screen.queryByRole("button", { name: /Export all/i })
      ).not.toBeInTheDocument();
    });
  });
});
