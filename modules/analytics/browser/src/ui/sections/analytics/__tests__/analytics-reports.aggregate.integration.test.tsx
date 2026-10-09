/**
 * @vitest-environment jsdom
 * The reports body's writes (rename, "Add chart", the empty state's invitation) follow the
 * grants the shell answers; the shell refuses project-tier writes on an aggregate (ADR-177).
 * @see specs/governance/aggregate-project.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../../testing.tsx";

const { projectRef, deniedRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", slug: "proj", kind: "application" } },
  deniedRef: { current: new Set<string>() },
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    organization: { id: "org-1" },
    hasPermission: (permission: string) => !deniedRef.current.has(permission),
  }),
}));

vi.mock("../../../../behavior/analytics-api.ts", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    analyticsApi: {
      useUtils: () => ({ graphs: { getAll: { invalidate: vi.fn() } } }),
      dashboards: { rename: { useMutation: mutation } },
      graphs: { delete: { useMutation: mutation }, batchUpdateLayouts: { useMutation: mutation } },
      dashboardWidgets: {
        delete: { useMutation: mutation },
        batchUpdateLayouts: { useMutation: mutation },
      },
    },
  };
});

vi.mock("../../../../behavior/use-dashboards.ts", () => ({
  useFirstDashboard: () => ({ data: null }),
  useDashboards: () => ({ data: [], refetch: vi.fn() }),
  useDashboardGraphs: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useDashboardWidgets: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
}));

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

// The layout is the page chrome; what the body hands it is under test.
vi.mock("../../analytics-layout.tsx", () => ({
  default: ({
    title,
    analyticsHeaderProps,
    extraHeaderButtons,
    children,
  }: {
    title: string;
    analyticsHeaderProps?: { isEditable?: boolean };
    extraHeaderButtons?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div>
      <h1 data-editable={String(!!analyticsHeaderProps?.isEditable)}>{title}</h1>
      {extraHeaderButtons}
      {children}
    </div>
  ),
}));
vi.mock("../../report-grid.tsx", () => ({ ReportGrid: () => null }));
vi.mock("../../filter-sidebar.tsx", () => ({ FilterSidebar: () => null }));
vi.mock("../../dashboard-auto-refresh-menu.tsx", () => ({ DashboardAutoRefreshMenu: () => null }));
vi.mock(
  "../../../../features/dashboard-widget/ui/sections/create-dashboard-widget-drawer.tsx",
  () => ({ CreateDashboardWidgetDrawer: () => null }),
);

import { ReportsContent } from "../analytics-reports.screen.tsx";

const renderReports = () =>
  render(
    <AnalyticsTestHarness host={new StubAnalyticsHost()}>
      <ReportsContent />
    </AnalyticsTestHarness>,
  );

afterEach(() => {
  cleanup();
  deniedRef.current = new Set();
});

describe("<ReportsContent/>", () => {
  describe("given an ordinary project with no charts", () => {
    it("offers to rename the dashboard and to add a chart", () => {
      projectRef.current = { id: "proj-1", slug: "proj", kind: "application" };

      renderReports();

      expect(screen.getByRole("heading", { name: "Reports" })).toHaveAttribute(
        "data-editable",
        "true",
      );
      expect(screen.getByRole("button", { name: /Add chart/ })).toBeInTheDocument();
      expect(screen.getByText("Add your custom graphs here")).toBeInTheDocument();
    });
  });

  describe("given an aggregate project, whose analytics writes the shell refuses", () => {
    /** @scenario "The aggregate's reports offer no chart to add" */
    it("keeps the title read only and offers no chart to add", () => {
      projectRef.current = { id: "agg-1", slug: "agg", kind: "aggregate" };
      deniedRef.current = new Set(["analytics:create", "analytics:update"]);

      renderReports();

      expect(screen.getByRole("heading", { name: "Reports" })).toHaveAttribute(
        "data-editable",
        "false",
      );
      expect(screen.queryByRole("button", { name: /Add chart/ })).toBeNull();
      expect(screen.queryByText("Add your custom graphs here")).toBeNull();
      expect(screen.queryByText(/Click \+ Add chart/)).toBeNull();
    });
  });

  describe("given a member without analytics:create and no charts", () => {
    /** @scenario "A member who cannot add charts still sees the empty reports" */
    it("shows the empty state but no add-chart button", () => {
      projectRef.current = { id: "proj-1", slug: "proj", kind: "application" };
      deniedRef.current = new Set(["analytics:create"]);

      renderReports();

      expect(screen.getByText("No custom graphs yet")).toBeInTheDocument();
      expect(
        screen.getByText("Nobody has added a custom graph to this dashboard yet."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add chart/ })).toBeNull();
      expect(screen.queryByText(/Click \+ Add chart/)).toBeNull();
    });
  });
});
