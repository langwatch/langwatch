/**
 * @vitest-environment jsdom
 * An aggregate project's analytics pages draw over its members (ADR-177 v4.15), less what is
 * kept inside one project: its saved views, its topics and its monitors' own cards.
 * @see specs/governance/aggregate-project.feature
 */

import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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
vi.mock("../../../behavior/use-dashboards.ts", () => ({
  useProjectMonitors: ({ projectId }: { projectId: string }) => {
    monitorsRead(projectId);
    return {
      data: projectId
        ? [{ id: "mon-1", name: "Toxicity check", checkType: "custom/x", enabled: true }]
        : undefined,
    };
  },
}));
vi.mock("../analytics-header.tsx", () => ({
  AnalyticsHeader: ({ tabs }: { tabs: ReactNode }) => tabs,
}));
vi.mock("../custom-dashboards-section.tsx", () => ({
  DashboardsTabMenu: () => <p>dashboards menu</p>,
}));
vi.mock("../../../behavior/use-filter-toggle.ts", () => ({
  useFilterToggle: () => ({ showFilters: true }),
}));
vi.mock("../topics-selector.tsx", () => ({ TopicsSelector: () => <p>topic picker</p> }));
vi.mock("../fields-filters.tsx", () => ({ QueryStringFieldsFilters: () => null }));
vi.mock("../custom-graph.tsx", () => ({
  CustomGraph: ({ input }: { input: { graphId: string } }) => <p>{input.graphId}</p>,
}));

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
          <FilterSidebar />
        </AnalyticsLayout>,
        { project: projectOfKind("aggregate") },
      );

      expect(tabLabels()).toEqual(["Overview", "Users", "LLM metrics", "Evaluations"]);
      expect(screen.queryByText("topic picker")).not.toBeInTheDocument();
    });

    /** @scenario "The aggregate hides the views that only make sense inside one project" */
    it("offers no Dashboards menu, which would open with nothing in it", () => {
      renderWithAnalyticsHost(
        <AnalyticsLayout tab="overview">
          <p>the charts</p>
        </AnalyticsLayout>,
        { project: projectOfKind("aggregate") },
      );

      expect(screen.queryByText("dashboards menu")).not.toBeInTheDocument();
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
          <FilterSidebar />
        </AnalyticsLayout>,
        { project: projectOfKind("application") },
      );
      expect(tabLabels()).toContain("Topics");
      expect(screen.getByText("topic picker")).toBeInTheDocument();
      expect(screen.getByText("dashboards menu")).toBeInTheDocument();
    });

    it("still draws a card per monitor on the evaluations page", () => {
      renderWithAnalyticsHost(<AnalyticsEvaluationsScreen />, {
        project: projectOfKind("application"),
      });

      expect(screen.getAllByText("Toxicity check").length).toBeGreaterThan(0);
    });
  });
});
