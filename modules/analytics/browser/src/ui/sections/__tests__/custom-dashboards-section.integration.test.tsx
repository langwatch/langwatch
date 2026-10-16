/**
 * @vitest-environment jsdom
 * The Dashboards tab menu and the current dashboard's actions: pick, add, reorder, delete.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";

const api = vi.hoisted(() => ({
  dashboards: [] as { id: string; name: string }[],
  sent: [] as unknown[],
}));

vi.mock("../../../behavior/analytics-api.ts", () => {
  const mutation = (name: string) => ({
    useMutation: () => ({
      mutate: (input: unknown) => api.sent.push({ [name]: input }),
      isPending: false,
    }),
  });
  return {
    analyticsApi: {
      useUtils: () => ({ licenseEnforcement: { checkLimit: { invalidate: vi.fn() } } }),
      dashboards: {
        getAll: {
          useQuery: () => ({ data: api.dashboards, isLoading: false, refetch: vi.fn() }),
        },
        rename: mutation("rename"),
        delete: mutation("delete"),
        reorderDashboards: mutation("reorder"),
        create: mutation("create"),
      },
    },
  };
});

import { DashboardActionsMenu, DashboardsTabMenu } from "../custom-dashboards-section.tsx";

const THREE = [
  { id: "d1", name: "Overview" },
  { id: "d2", name: "Costs" },
  { id: "d3", name: "Quality" },
];

function mountTab({
  dashboards,
  host = new StubAnalyticsHost({ route: { params: {}, query: {} } }),
  activeDashboardId,
  isActive = true,
}: {
  dashboards: { id: string; name: string }[];
  host?: StubAnalyticsHost;
  activeDashboardId?: string;
  isActive?: boolean;
}) {
  api.dashboards = dashboards;
  api.sent = [];
  render(
    <AnalyticsTestHarness host={host}>
      <DashboardsTabMenu
        projectSlug="my-project"
        activeDashboardId={activeDashboardId}
        isActive={isActive}
      />
    </AnalyticsTestHarness>,
  );
  return userEvent.setup();
}

function mountActions({ dashboardId, onRename }: { dashboardId: string; onRename?: () => void }) {
  api.sent = [];
  render(
    <AnalyticsTestHarness host={new StubAnalyticsHost()}>
      <DashboardActionsMenu
        projectSlug="my-project"
        dashboardId={dashboardId}
        onRename={onRename}
      />
    </AnalyticsTestHarness>,
  );
  const user = userEvent.setup();
  return { user, open: () => user.click(screen.getByTestId("analytics-dashboard-menu")) };
}

describe("the Dashboards tab", () => {
  beforeEach(() => {
    api.sent = [];
  });

  it("names the dashboard on screen, defaulted when the URL has no dashboard ID", () => {
    mountTab({ dashboards: THREE, activeDashboardId: "d2" });
    expect(screen.getByTestId("analytics-dashboards-tab")).toHaveTextContent("Costs");
  });

  it("reads Dashboards on another analytics page", () => {
    mountTab({ dashboards: THREE, isActive: false });
    expect(screen.getByTestId("analytics-dashboards-tab")).toHaveTextContent("Dashboards");
  });

  it("lists every dashboard and offers to add one", async () => {
    const user = mountTab({ dashboards: THREE, activeDashboardId: "d1" });
    await user.click(screen.getByTestId("analytics-dashboards-tab"));
    for (const dashboard of THREE) {
      expect(screen.getByRole("menuitem", { name: dashboard.name })).toBeInTheDocument();
    }
    expect(screen.getByTestId("analytics-dashboard-add")).toBeInTheDocument();
  });
});

describe("the current dashboard's actions", () => {
  beforeEach(() => {
    api.dashboards = THREE;
  });

  it("offers move up and down only where there is room, and delete only with more than one", async () => {
    const { open } = mountActions({ dashboardId: "d1" });
    await open();
    expect(screen.queryByText("Move up")).toBeNull();
    expect(screen.getByText("Move down")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("reorders by swapping with the neighbour", async () => {
    const { user, open } = mountActions({ dashboardId: "d2" });
    await open();
    await user.click(screen.getByText("Move up"));
    expect(api.sent).toEqual([
      { reorder: { projectId: "proj-1", dashboardIds: ["d2", "d1", "d3"] } },
    ]);
  });

  it("hands rename back to the title row", async () => {
    const onRename = vi.fn();
    const { user, open } = mountActions({ dashboardId: "d3", onRename });
    await open();
    await user.click(screen.getByText("Rename"));
    expect(onRename).toHaveBeenCalledOnce();
  });

  /** @scenario "AC199d Split: a Reports delete leaves the Dashboards area unchanged" */
  it("deletes after confirmation through the Reports procedure alone", async () => {
    const { user, open } = mountActions({ dashboardId: "d2" });
    await open();
    await user.click(screen.getByText("Delete"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.sent).toEqual([{ delete: { projectId: "proj-1", dashboardId: "d2" } }]);
  });

  it("never offers to delete the last dashboard", async () => {
    api.dashboards = [{ id: "d1", name: "Overview" }];
    const { open } = mountActions({ dashboardId: "d1" });
    await open();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});

describe("the dashboard list on an aggregate project", () => {
  /** @scenario "The app marks the aggregate and offers no way to add data to it" */
  it("offers no way to create a dashboard", async () => {
    const host = new StubAnalyticsHost({
      project: {
        id: "proj-agg",
        slug: "company-traces",
        name: "Company Traces",
        hasFirstMessage: true,
        kind: "aggregate",
      },
    });
    const user = mountTab({ dashboards: [], host });
    await user.click(screen.getByTestId("analytics-dashboards-tab"));
    expect(screen.queryByTestId("analytics-dashboard-add")).not.toBeInTheDocument();
  });
});
