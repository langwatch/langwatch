/**
 * @vitest-environment jsdom
 * An aggregate project's analytics pages draw over its members (ADR-177 v4.15), less what is
 * kept inside one project: its saved views, its topics and its monitors' own cards.
 * @see specs/governance/aggregate-project.feature
 */

import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type * as UseDashboards from "../../../behavior/use-dashboards.ts";
import { renderWithAnalyticsHost } from "../../../testing.tsx";

const savedViewsRead = vi.fn();
const monitorsRead = vi.fn();

vi.mock("../../../behavior/use-saved-views.tsx", () => ({
  SavedViewsProvider: ({ children }: { children: ReactNode }) => {
    savedViewsRead();
    return children;
  },
  useSavedViews: () => ({
    defaultViews: [{ id: "all-traces", name: "All Traces", origin: null }],
    customViews: [],
    selectedViewId: "all-traces",
    handleViewClick: vi.fn(),
    deleteView: vi.fn(),
    renameView: vi.fn(),
    reorderViews: vi.fn(),
  }),
}));
vi.mock("../../../behavior/use-dashboards.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof UseDashboards>()),
  useProjectMonitors: ({ projectId }: { projectId: string }) => {
    monitorsRead(projectId);
    return {
      data: projectId
        ? [{ id: "mon-1", name: "Toxicity check", checkType: "custom/x", enabled: true }]
        : undefined,
    };
  },
}));
// Every other procedure the screens read answers as an empty, settled query: the screens are
// drawn whole, and only the tRPC client under them is replaced.
vi.mock("../../../behavior/analytics-api.ts", () => {
  const settled = { data: undefined, isLoading: false, isError: false, isFetched: true };
  const procedure = (): unknown =>
    new Proxy(() => undefined, {
      get: (_target, prop) => {
        if (prop === "useQuery" || prop === "useInfiniteQuery") return () => settled;
        if (prop === "useMutation") return () => ({ mutate: vi.fn(), mutateAsync: vi.fn() });
        if (prop === "then") return undefined;
        return procedure();
      },
      apply: () => procedure(),
    });
  return { analyticsApi: procedure() };
});

import AnalyticsLayout from "../analytics-layout.tsx";
import AnalyticsEvaluationsScreen from "../analytics/analytics-evaluations.screen.tsx";
import { FilterSidebar } from "../filter-sidebar.tsx";

const projectOfKind = (kind: string) => ({
  id: `proj-${kind}`,
  slug: "company-traces",
  name: "Company Traces",
  hasFirstMessage: true,
  kind,
});

const tabLabels = () =>
  Array.from(screen.getByRole("navigation", { name: "Analytics pages" }).querySelectorAll("a")).map(
    (link) => link.textContent,
  );

describe("the analytics pages on an aggregate project", () => {
  describe("given an aggregate opened by a direct link", () => {
    /** @scenario "A direct link to the aggregate's analytics opens the page" */
    it("draws the page and shows no saved views, reading none", () => {
      savedViewsRead.mockClear();
      renderWithAnalyticsHost(
        <AnalyticsLayout tab="metrics">
          <p>the charts</p>
        </AnalyticsLayout>,
        { project: projectOfKind("aggregate") },
      );

      expect(screen.getByText("the charts")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View options" })).not.toBeInTheDocument();
      expect(savedViewsRead).not.toHaveBeenCalled();
    });

    /** @scenario "The aggregate hides the views that only make sense inside one project" */
    it("offers no Topics tab and no topic picker", () => {
      renderWithAnalyticsHost(
        <AnalyticsLayout tab="overview">
          <FilterSidebar defaultShowFilters />
        </AnalyticsLayout>,
        { project: projectOfKind("aggregate") },
      );

      expect(tabLabels()).toEqual(["Overview", "Users", "LLM metrics", "Evaluations"]);
      expect(screen.queryByText("No topics found")).not.toBeInTheDocument();
    });

    /** @scenario "The aggregate hides the views that only make sense inside one project" */
    it("offers no Dashboards menu, which would open with nothing in it", () => {
      renderWithAnalyticsHost(
        <AnalyticsLayout tab="overview">
          <p>the charts</p>
        </AnalyticsLayout>,
        { project: projectOfKind("aggregate") },
      );

      expect(screen.queryByText("Dashboards")).not.toBeInTheDocument();
    });

    /** @scenario "The aggregate hides the views that only make sense inside one project" */
    it("shows the overall health and trend cards and no card for one monitor", () => {
      monitorsRead.mockClear();
      renderWithAnalyticsHost(<AnalyticsEvaluationsScreen />, {
        project: projectOfKind("aggregate"),
      });

      expect(screen.getByText("Overall Health")).toBeInTheDocument();
      expect(screen.getByText("Pass / Fail Trend")).toBeInTheDocument();
      expect(screen.queryByText("Toxicity check")).not.toBeInTheDocument();
      expect(screen.queryByText("No online evaluations yet")).not.toBeInTheDocument();
      expect(monitorsRead).toHaveBeenCalledWith("");
    });
  });

  describe("given an ordinary project", () => {
    /** @scenario "A direct link to the aggregate's analytics opens the page" */
    it("still shows the saved views bar", () => {
      renderWithAnalyticsHost(
        <AnalyticsLayout tab="metrics">
          <p>the charts</p>
        </AnalyticsLayout>,
        { project: projectOfKind("application") },
      );

      expect(screen.getByRole("button", { name: "View options" })).toBeInTheDocument();
    });

    /** @scenario "The aggregate hides the views that only make sense inside one project" */
    it("still offers its topics and its monitors' cards", () => {
      renderWithAnalyticsHost(
        <AnalyticsLayout tab="overview">
          <FilterSidebar defaultShowFilters />
        </AnalyticsLayout>,
        { project: projectOfKind("application") },
      );
      expect(tabLabels()).toContain("Topics");
      expect(screen.getByText("No topics found")).toBeInTheDocument();
      expect(screen.getByText("Dashboards")).toBeInTheDocument();
    });

    it("still draws a card per monitor on the evaluations page", () => {
      renderWithAnalyticsHost(<AnalyticsEvaluationsScreen />, {
        project: projectOfKind("application"),
      });

      expect(screen.getAllByText("Toxicity check").length).toBeGreaterThan(0);
    });
  });
});
