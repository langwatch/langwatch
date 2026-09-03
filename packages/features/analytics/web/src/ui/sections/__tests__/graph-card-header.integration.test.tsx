/**
 * What a dashboard card's header offers.
 *
 * The file used to pin the alert-button wiring (Phase 5.2 of ADR-034), which is
 * the behaviour this move removed — see the note inside.
 *
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing";
import { GraphCardHeader } from "../graph-card-header";

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
      projectSlug="proj"
      colSpan={1}
      rowSpan={1}
      filters={{}}
      isDragging={false}
      dragAttributes={{} as unknown as Parameters<typeof GraphCardHeader>[0]["dragAttributes"]}
      dragListeners={undefined}
      onSizeChange={vi.fn()}
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
   * THE ALERT ENTRY POINTS ARE GONE, AND SO ARE THE TWO TESTS THAT PINNED THEM.
   *
   * Both scenarios asserted that the bell and the "Add alert" button opened the
   * automations drawer pre-filled with this graph and its first series. That
   * drawer's registry entry was deleted when the automations family moved, so
   * the two call sites had not compiled since; the header drops them, and a
   * test for behaviour a screen no longer has is a test that cannot fail
   * honestly. Deleted rather than rewritten into an assertion of absence
   * dressed up as a feature — what replaces them is the one below, which says
   * plainly that the header offers no way to author an alert, so the day a
   * cross-feature overlay capability lands somebody has to come back here.
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
