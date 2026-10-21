/**
 * @vitest-environment jsdom
 * A page whose subject is kept inside one project (Topics) says so on an aggregate (ADR-177
 * v4.15) and starts no chart.
 * @see specs/governance/aggregate-project.feature
 */

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithAnalyticsHost } from "../../../testing.tsx";
import { withAggregateAnalyticsGate } from "../aggregate-analytics-gate.tsx";

const charts = vi.fn();

function ChartsScreen() {
  charts();
  return <p>the charts</p>;
}

const GatedScreen = withAggregateAnalyticsGate("Topics", ChartsScreen);

const projectOfKind = (kind: string) => ({
  id: "proj-1",
  slug: "company-traces",
  name: "Company Traces",
  hasFirstMessage: true,
  kind,
});

describe("withAggregateAnalyticsGate()", () => {
  describe("when the project is an ordinary one", () => {
    it("renders its charts", () => {
      renderWithAnalyticsHost(<GatedScreen />, { project: projectOfKind("application") });

      expect(screen.getByText("the charts")).toBeInTheDocument();
    });
  });

  describe("when the project is an aggregate", () => {
    /** @scenario "The aggregate hides the views that only make sense inside one project" */
    it("renders the page's heading and the notice instead of the page", () => {
      charts.mockClear();
      renderWithAnalyticsHost(<GatedScreen />, { project: projectOfKind("aggregate") });

      expect(screen.getByText("Topics")).toBeInTheDocument();
      expect(screen.getByText(/This page shows one project at a time/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open Trace Explorer" })).toHaveAttribute(
        "href",
        "/company-traces/traces",
      );
      expect(charts).not.toHaveBeenCalled();
    });
  });
});
