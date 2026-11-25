/**
 * @vitest-environment jsdom
 * Every analytics page carries the saved-views strip, with its "View options" menu.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";

vi.mock("../../../behavior/use-saved-views.tsx", () => ({
  SavedViewsProvider: ({ children }: { children: React.ReactNode }) => children,
  useSavedViews: () => ({
    defaultViews: [{ id: "all-traces", name: "All Traces", origin: null }],
    customViews: [{ id: "v1", name: "Errors only", filters: {} }],
    selectedViewId: "all-traces",
    handleViewClick: vi.fn(),
    deleteView: vi.fn(),
    renameView: vi.fn(),
    reorderViews: vi.fn(),
  }),
}));
vi.mock("../analytics-header.tsx", () => ({
  AnalyticsHeader: ({ tabs }: { tabs: React.ReactNode }) => tabs,
}));
vi.mock("../custom-dashboards-section.tsx", () => ({ DashboardsTabMenu: () => null }));
vi.mock("../../../behavior/use-filter-toggle.ts", () => ({
  useFilterToggle: () => ({ showFilters: false }),
}));

import AnalyticsLayout from "../analytics-layout.tsx";

describe("the analytics page", () => {
  it("shows the saved views and the view options menu under its content", () => {
    render(
      <AnalyticsTestHarness host={new StubAnalyticsHost()}>
        <AnalyticsLayout tab="overview">
          <p>page content</p>
        </AnalyticsLayout>
      </AnalyticsTestHarness>,
    );

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByText("All Traces")).toBeInTheDocument();
    expect(screen.getByText("Errors only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View options" })).toBeInTheDocument();
  });

  it("lists every analytics page as a header tab and marks the current one", () => {
    render(
      <AnalyticsTestHarness host={new StubAnalyticsHost()}>
        <AnalyticsLayout tab="evaluations">
          <p>page content</p>
        </AnalyticsLayout>
      </AnalyticsTestHarness>,
    );

    const tabs = screen.getByRole("navigation", { name: "Analytics pages" });
    const links = Array.from(tabs.querySelectorAll("a")).map((link) => link.textContent);
    expect(links).toEqual(["Overview", "Users", "Topics", "LLM metrics", "Evaluations"]);
    expect(screen.getByRole("link", { name: "Evaluations" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Users" })).not.toHaveAttribute("aria-current");
  });
});
