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

const { projectRef, deniedRef, graphsRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", slug: "proj", kind: "application" } },
  deniedRef: { current: new Set<string>() },
  graphsRef: { current: [] as { id: string }[] },
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    organization: { id: "org-1" },
  }),
}));

vi.mock("../../../../behavior/analytics-api.ts", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    analyticsApi: {
      useUtils: () => ({ graphs: { getAll: { invalidate: vi.fn() } } }),
      dashboards: { rename: { useMutation: mutation } },
      graphs: { delete: { useMutation: mutation }, batchUpdateLayouts: { useMutation: mutation } },
    },
  };
});

vi.mock("../../../../behavior/use-dashboards.ts", () => ({
  useFirstDashboard: () => ({ data: null }),
  useDashboards: () => ({ data: [], refetch: vi.fn() }),
  useDashboardGraphs: () => ({ data: graphsRef.current, isLoading: false, refetch: vi.fn() }),
}));

// The layout is the page chrome; what the body hands it is under test.
vi.mock("../../analytics-layout.tsx", () => ({
  default: ({
    dashboard,
    children,
  }: {
    dashboard?: { title: string; isEditable?: boolean; actions?: React.ReactNode };
    children?: React.ReactNode;
  }) => (
    <div>
      <h1 data-editable={String(!!dashboard?.isEditable)}>{dashboard?.title}</h1>
      {dashboard?.actions}
      {children}
    </div>
  ),
}));
vi.mock("../../report-grid.tsx", () => ({
  ReportGrid: ({ graphs }: { graphs: { id: string }[] }) => (
    <ul data-testid="report-grid">
      {graphs.map(({ id }) => (
        <li key={id}>{id}</li>
      ))}
    </ul>
  ),
}));
vi.mock("../../filter-sidebar.tsx", () => ({ FilterSidebar: () => null }));
vi.mock("../../dashboard-auto-refresh-menu.tsx", () => ({ DashboardAutoRefreshMenu: () => null }));

import { ReportsContent } from "../analytics-reports.screen.tsx";

const renderReports = () =>
  render(
    <AnalyticsTestHarness
      host={
        new StubAnalyticsHost({
          permissions: ["analytics:view", "analytics:create", "analytics:update"].filter(
            (permission) => !deniedRef.current.has(permission),
          ),
        })
      }
    >
      <ReportsContent />
    </AnalyticsTestHarness>,
  );

afterEach(() => {
  cleanup();
  deniedRef.current = new Set();
  graphsRef.current = [];
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

describe("<ReportsContent/> and Dashboards widgets", () => {
  /** @scenario "The legacy reports page neither shows nor adds dashboard widgets" */
  it("draws only the charts made in Reports and links Add chart to the chart builder", () => {
    projectRef.current = { id: "proj-1", slug: "proj", kind: "application" };
    graphsRef.current = [{ id: "builder_chart" }];

    renderReports();

    expect(screen.getByTestId("report-grid").textContent).toBe("builder_chart");
    expect(screen.getByTestId("analytics-add-chart")).toHaveAttribute(
      "href",
      expect.stringContaining("/proj/analytics/custom"),
    );
  });
});

describe("<ReportsContent/> opened on a dashboard id that does not exist", () => {
  /** @scenario "A link to a missing dashboard says so" */
  it("says the dashboard does not exist instead of an empty grid", () => {
    projectRef.current = { id: "proj-1", slug: "proj", kind: "application" };

    render(
      <AnalyticsTestHarness
        host={
          new StubAnalyticsHost({
            permissions: ["analytics:view", "analytics:create", "analytics:update"],
            route: { params: {}, query: { dashboard: "dashboard_missing" } },
          })
        }
      >
        <ReportsContent />
      </AnalyticsTestHarness>,
    );

    expect(screen.getByText("This dashboard doesn't exist")).toBeInTheDocument();
    expect(screen.queryByText("Add your custom graphs here")).toBeNull();
  });
});
