/**
 * @vitest-environment jsdom
 *
 * The Observe page's panes: filters, table, drawer, and the guide for no traces.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useUIStore } from "../../../../../behavior/ui.store.ts";
import { TracesPage } from "../traces-page.tsx";

const page = vi.hoisted(() => ({
  hasAnyTraces: true as boolean | undefined,
  drawerTraceId: null as string | null,
}));

vi.mock("../../../../../behavior/explorer/use-project-has-traces.ts", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: page.hasAnyTraces }),
}));
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1", slug: "acme" } }),
}));
vi.mock("../../../../../behavior/trace-drawer.ts", () => ({
  useTraceDrawer: (select: (state: { traceId: string | null }) => unknown) =>
    select({ traceId: page.drawerTraceId }),
  useDismissTraceDrawer: () => vi.fn(),
}));

vi.mock("../../../presence/hooks/use-traces-v2-presence.ts", () => ({
  useTracesPresence: () => undefined,
}));
vi.mock("../../hooks/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => ({ totalHits: 0, pageTraceIds: [], itemNoun: "traces" }),
}));
vi.mock("../../hooks/use-instant-eval-run-watch.ts", () => ({
  useInstantEvalRunWatch: () => undefined,
}));
vi.mock("../../hooks/use-lens-filter-dirty-sync.ts", () => ({
  useLensFilterDirtySync: () => undefined,
}));
vi.mock("../../hooks/use-lens-sync.ts", () => ({ useLensSync: () => undefined }));
vi.mock("../../hooks/use-reset-selection-on-view-change.ts", () => ({
  useResetSelectionOnViewChange: () => undefined,
}));
vi.mock("../../hooks/use-rolling-time-range.ts", () => ({
  useRollingTimeRange: () => undefined,
}));
vi.mock("../../hooks/use-trace-drawer-url-hydrator.ts", () => ({
  useTraceDrawerUrlHydrator: () => undefined,
}));
vi.mock("../../hooks/use-trace-freshness.ts", () => ({ useTraceFreshness: () => undefined }));
vi.mock("../../hooks/use-trace-list-export.ts", () => ({
  useTraceListExport: () => ({
    isDialogOpen: false,
    openExportDialog: vi.fn(),
    closeExportDialog: vi.fn(),
    isExporting: false,
    progress: { exported: 0 },
    startExport: vi.fn(),
    cancelExport: vi.fn(),
  }),
}));
vi.mock("../../hooks/use-trace-list-query.ts", () => ({
  useTraceListQuery: () => ({ data: [] }),
}));
vi.mock("../../hooks/use-url-sync.ts", () => ({ useURLSync: () => undefined }));
vi.mock("../use-debounced-filter-commit.ts", () => ({
  useDebouncedFilterCommit: () => undefined,
}));
vi.mock("../use-keyboard-shortcuts.ts", () => ({
  useClearSelectionShortcut: () => undefined,
  useDensityToggleShortcut: () => undefined,
  useFindShortcut: () => undefined,
  useShortcutsHelpShortcut: () => undefined,
  useSidebarShortcut: () => undefined,
}));
vi.mock("../use-page-title.ts", () => ({ useTracesPageTitle: () => undefined }));
vi.mock("../../onboarding/hooks/use-first-trace-spotlight-trigger.ts", () => ({
  useFirstTraceSpotlightTrigger: () => undefined,
}));
vi.mock("../../onboarding/index.ts", () => ({
  OnboardingHost: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../onboarding/spotlights/spotlight-overlay.tsx", () => ({
  SpotlightOverlay: () => null,
}));

vi.mock("../../filter-sidebar/filter-sidebar.tsx", () => ({
  FilterSidebar: () => <div data-testid="filter-sidebar" />,
}));
vi.mock("../../search-bar/search-bar.tsx", () => ({
  SearchBar: () => <div data-testid="search-bar" />,
}));
vi.mock("../../toolbar/toolbar.tsx", () => ({ Toolbar: () => <div data-testid="toolbar" /> }));
vi.mock("../../toolbar/bulk-action-bar.tsx", () => ({ BulkActionBar: () => null }));
vi.mock("../../trace-table/trace-table.tsx", () => ({
  TraceTable: () => <div data-testid="trace-table" />,
}));
vi.mock("../../trace-drawer/index.ts", () => ({
  TraceV2DrawerShell: () => <div data-testid="trace-drawer" />,
}));
vi.mock("../integrate-pane.tsx", () => ({
  IntegratePane: () => <div data-testid="integrate-pane" />,
}));
vi.mock("../empty-results-pane.tsx", () => ({ EmptyResultsPane: () => null }));
vi.mock("../explorer-langy-actions.tsx", () => ({ ExplorerLangyActions: () => null }));
vi.mock("../page-keyboard-shortcuts.tsx", () => ({ PageKeyboardShortcuts: () => null }));
vi.mock("../../export-config-dialog.tsx", () => ({ ExportConfigDialog: () => null }));
vi.mock("../../find-bar/index.ts", () => ({ FindBar: () => null }));
vi.mock("../../instant-eval-progress-banner.tsx", () => ({
  InstantEvalProgressBanner: () => null,
}));

beforeEach(() => {
  page.hasAnyTraces = true;
  page.drawerTraceId = null;
  useUIStore.setState({ sidebarCollapsed: false, mobileExpandedOverride: true });
});

afterEach(() => cleanup());

const follows = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("<TracesPage />", () => {
  describe("given the project has traces", () => {
    it("with the filters open, puts them left, the table in the centre and the drawer right once a trace is open", () => {
      const view = renderWithDesignSystem(<TracesPage />);

      const filters = screen.getByRole("complementary", { name: "Trace filters" });
      const results = screen.getByRole("main", { name: "Trace results" });
      expect(filters).toContainElement(screen.getByTestId("filter-sidebar"));
      expect(results).toContainElement(screen.getByTestId("trace-table"));
      expect(follows(filters, results)).toBe(true);
      expect(screen.queryByTestId("trace-drawer")).not.toBeInTheDocument();

      page.drawerTraceId = "trace-1";
      view.rerender(<TracesPage />);

      expect(follows(results, screen.getByTestId("trace-drawer"))).toBe(true);
    });
  });

  describe("given the project has zero traces", () => {
    /** @scenario Zero traces in project shows onboarding empty state */
    it("shows the integration guide instead of the table and the filters", () => {
      page.hasAnyTraces = false;

      renderWithDesignSystem(<TracesPage />);

      expect(screen.getByTestId("integrate-pane")).toBeInTheDocument();
      expect(screen.queryByTestId("trace-table")).not.toBeInTheDocument();
      expect(screen.queryByTestId("filter-sidebar")).not.toBeInTheDocument();
    });
  });
});
