/**
 * @vitest-environment jsdom
 * An aggregate project's analytics do not read across its members yet (ADR-177): every
 * analytics address says so and starts no chart.
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

const GatedScreen = withAggregateAnalyticsGate("LLM Metrics", ChartsScreen);

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
    /** @scenario "A direct link to the aggregate's analytics says it is not available yet" */
    it("renders the page's heading and the notice instead of the page", () => {
      charts.mockClear();
      renderWithAnalyticsHost(<GatedScreen />, { project: projectOfKind("aggregate") });

      expect(screen.getByText("LLM Metrics")).toBeInTheDocument();
      expect(
        screen.getByText(/Analytics across member projects is not available yet/),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open Trace Explorer" })).toHaveAttribute(
        "href",
        "/company-traces/traces",
      );
      expect(charts).not.toHaveBeenCalled();
    });
  });
});
