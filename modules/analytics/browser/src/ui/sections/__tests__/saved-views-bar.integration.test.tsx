/**
 * @vitest-environment jsdom
 * Every analytics page carries the saved-views strip, with its "View options" menu.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";

vi.mock("../use-saved-views.tsx", () => ({
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
vi.mock("../analytics-header.tsx", () => ({ AnalyticsHeader: () => null }));
vi.mock("../custom-dashboards-section.tsx", () => ({ CustomDashboardsSection: () => null }));
vi.mock("../../../behavior/use-filter-toggle.ts", () => ({
  useFilterToggle: () => ({ showFilters: false }),
}));

import AnalyticsLayout from "../analytics-layout.tsx";

describe("the analytics page", () => {
  it("shows the saved views and the view options menu under its content", () => {
    render(
      <AnalyticsTestHarness host={new StubAnalyticsHost()}>
        <AnalyticsLayout title="Analytics" railEntry="overview">
          <p>page content</p>
        </AnalyticsLayout>
      </AnalyticsTestHarness>,
    );

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByText("All Traces")).toBeInTheDocument();
    expect(screen.getByText("Errors only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View options" })).toBeInTheDocument();
  });

  it("lists every analytics page in its rail and marks the current one", () => {
    render(
      <AnalyticsTestHarness host={new StubAnalyticsHost()}>
        <AnalyticsLayout title="Online Evaluations" railEntry="evaluations">
          <p>page content</p>
        </AnalyticsLayout>
      </AnalyticsTestHarness>,
    );

    const rail = screen.getByRole("navigation", { name: "Analytics navigation" });
    const links = Array.from(rail.querySelectorAll("a")).map((link) => link.textContent);
    expect(links).toEqual(["Overview", "Users", "Topics", "LLM Metrics", "Online Evaluations"]);
    expect(screen.getByRole("link", { name: "Online Evaluations" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
