/**
 * @vitest-environment jsdom
 * What a dashboard card's header offers. Used to pin the alert-button
 * wiring (ADR-034 Phase 5.2), removed here — see the note inside.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import { GraphCardHeader } from "../graph-card-header.tsx";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <AnalyticsTestHarness host={new StubAnalyticsHost()}>{children}</AnalyticsTestHarness>
);

function renderHeader() {
  return render(
    <GraphCardHeader
      graphId="graph_123"
      name="p95 latency"
      graph={{
        graphType: "line",
        series: [
          { name: "p95 latency", key: "latency", aggregation: "p95" },
          { name: "error rate", key: "error_rate", aggregation: "avg" },
        ],
        includePrevious: false,
        timeScale: "full",
      }}
      projectId="project_1"
      projectSlug="proj"
      filters={{}}
      isDragging={false}
      dragListeners={undefined}
      onDelete={vi.fn()}
      isDeleting={false}
    />,
    { wrapper: Wrapper },
  );
}

describe("GraphCardHeader", () => {
  afterEach(() => {
    cleanup();
  });

  /**
   * THE ALERT ENTRY POINTS ARE GONE, along with the tests that pinned them —
   * deleted, not rewritten into an absence assertion, since such a test
   * can't fail honestly. Revisit when a cross-feature overlay capability lands.
   */
  describe("given a saved builder graph", () => {
    describe("when its header renders", () => {
      it("offers no way to author an alert from the chart", () => {
        renderHeader();

        expect(screen.queryByRole("button", { name: /alert/i })).not.toBeInTheDocument();
      });
    });
  });
});
