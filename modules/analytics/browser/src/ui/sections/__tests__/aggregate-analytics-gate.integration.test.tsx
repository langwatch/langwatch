/**
 * @vitest-environment jsdom
 * A page whose subject is kept inside one project (Topics) leads an aggregate back to the
 * Overview (ADR-177 v4.15) and starts no chart.
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

const GatedScreen = withAggregateAnalyticsGate(ChartsScreen);

const projectOfKind = (kind: string) => ({
  id: "proj-1",
  slug: "company-traces",
  name: "Company Traces",
  hasFirstMessage: true,
  kind,
});

describe("withAggregateAnalyticsGate()", () => {
  describe("when the project is an ordinary one", () => {
    it("renders its charts and stays on the page", () => {
      const { host } = renderWithAnalyticsHost(<GatedScreen />, {
        project: projectOfKind("application"),
      });

      expect(screen.getByText("the charts")).toBeInTheDocument();
      expect(host.navigations).toEqual([]);
    });
  });

  describe("when the project is an aggregate", () => {
    /** @scenario "The aggregate hides the views that only make sense inside one project" */
    it("replaces the address with the Overview and starts no chart", () => {
      charts.mockClear();
      const { host } = renderWithAnalyticsHost(<GatedScreen />, {
        project: projectOfKind("aggregate"),
      });

      expect(host.replacements).toEqual(["/company-traces/analytics"]);
      expect(host.navigations).toEqual(["/company-traces/analytics"]);
      expect(screen.queryByText("the charts")).not.toBeInTheDocument();
      expect(screen.queryByText(/one project at a time/)).not.toBeInTheDocument();
      expect(charts).not.toHaveBeenCalled();
    });
  });
});
