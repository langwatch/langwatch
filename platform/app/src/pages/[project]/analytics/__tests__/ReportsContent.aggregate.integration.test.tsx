/**
 * @vitest-environment jsdom
 *
 * The reports body offers three writes: renaming the dashboard, "Add chart"
 * and the empty state's invitation to click it. Each is gated on the write
 * permission the server declares, which the app refuses on an aggregate
 * project (ADR-144). The empty state itself is shown to every member; only its
 * invitation follows the grant. The aggregate gate already keeps this body off
 * an aggregate's reports page; this holds if that page ever opens there.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportsContent } from "../reports";

const { projectRef, deniedRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", slug: "proj", kind: "application" } },
  /** Permissions the member does not hold. */
  deniedRef: { current: new Set<string>() },
}));

vi.mock("~/hooks/useOrganizationTeamProject", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/hooks/useOrganizationTeamProject")>();
  return {
    ...actual,
    // As the hook answers: every permission not denied is held, and a
    // project-tier write is refused on an aggregate.
    useOrganizationTeamProject: () => ({
      project: projectRef.current,
      organization: { id: "org-1" },
      hasPermission: (
        permission: Parameters<typeof actual.refusedOnAggregate>[0],
      ) =>
        !deniedRef.current.has(permission) &&
        !(
          projectRef.current.kind === "aggregate" &&
          actual.refusedOnAggregate(permission)
        ),
    }),
  };
});

vi.mock("~/utils/api", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    api: {
      dashboards: {
        getOrCreateFirst: { useQuery: () => ({ data: null }) },
        getAll: { useQuery: () => ({ data: [], refetch: vi.fn() }) },
        rename: { useMutation: mutation },
      },
      graphs: {
        getAll: { useQuery: () => ({ data: [], isLoading: false }) },
        delete: { useMutation: mutation },
        batchUpdateLayouts: { useMutation: mutation },
      },
      useUtils: () => ({ analytics: { invalidate: vi.fn() } }),
    },
  };
});

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), pathname: "" }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

// The layout is the page chrome; what the body hands it is under test.
vi.mock("~/components/GraphsLayout", () => ({
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
      <h1 data-editable={String(!!analyticsHeaderProps?.isEditable)}>
        {title}
      </h1>
      {extraHeaderButtons}
      {children}
    </div>
  ),
}));

vi.mock("~/components/analytics/reports", () => ({ ReportGrid: () => null }));
vi.mock("~/components/filters/FilterSidebar", () => ({
  FilterSidebar: () => null,
}));
vi.mock("~/components/filters/FilterToggle", () => ({
  useFilterToggle: () => ({ showFilters: false }),
}));
vi.mock("~/components/analytics/DashboardAutoRefreshMenu", () => ({
  DashboardAutoRefreshMenu: () => null,
}));
vi.mock("~/components/analytics/useDashboardAutoRefresh", async () => {
  const { createContext } = await import("react");
  return {
    DashboardRefreshedAtContext: createContext<number | null>(null),
    useDashboardAutoRefresh: () => ({
      option: "off",
      setOption: vi.fn(),
      refreshedAt: null,
    }),
  };
});
vi.mock("~/features/analytics-query/hooks/useWidgetGranularity", () => ({
  useWidgetGranularity: () => ({
    granularityByGraphId: {},
    setGranularity: vi.fn(),
  }),
}));
vi.mock(
  "~/features/custom-chart-playground/CreateDashboardWidgetDrawer",
  () => ({
    CreateDashboardWidgetDrawer: () => null,
  }),
);

const renderReports = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ReportsContent />
    </ChakraProvider>,
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

      expect(
        screen.getByRole("heading", { name: "Reports" }).dataset.editable,
      ).toBe("true");
      expect(screen.getByRole("button", { name: /Add chart/ })).toBeTruthy();
      expect(screen.getByText("Add your custom graphs here")).toBeTruthy();
    });
  });

  describe("given an aggregate project", () => {
    /** @scenario "The aggregate's reports offer no chart to add" */
    it("keeps the title read only and offers no chart to add", () => {
      projectRef.current = { id: "agg-1", slug: "agg", kind: "aggregate" };

      renderReports();

      expect(
        screen.getByRole("heading", { name: "Reports" }).dataset.editable,
      ).toBe("false");
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

      expect(screen.getByText("No custom graphs yet")).toBeTruthy();
      expect(
        screen.getByText(
          "Nobody has added a custom graph to this dashboard yet.",
        ),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Add chart/ })).toBeNull();
      expect(screen.queryByText(/Click \+ Add chart/)).toBeNull();
    });
  });
});
