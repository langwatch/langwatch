/**
 * @vitest-environment jsdom
 * What a dashboard card's header offers: the alert entry points (ADR-034 Phase 5.2).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";

// The card menu's "Add to dashboard" item reads tRPC hooks at render; the
// header scenario never opens it, so the client is stubbed rather than provided.
vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({}),
    dashboards: { getOrCreateFirst: { useQuery: () => ({ data: undefined }) } },
    dashboardWidgets: {
      assignDashboard: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { GraphCardHeader } from "../graph-card-header.tsx";

type Trigger = { id: string; active: boolean; alertType: string | null };

function renderHeader({ trigger = null }: { trigger?: Trigger | null } = {}) {
  const host = new StubAnalyticsHost();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AnalyticsTestHarness host={host}>{children}</AnalyticsTestHarness>
  );
  render(
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
      trigger={trigger}
      isDragging={false}
      dragListeners={undefined}
      onDelete={vi.fn()}
      isDeleting={false}
    />,
    { wrapper: Wrapper },
  );
  return host;
}

describe("GraphCardHeader", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given no trigger is configured", () => {
    describe("when the Add alert button is clicked", () => {
      it("opens automation's drawer prefilled with this graph and its first series", () => {
        const host = renderHeader();

        fireEvent.click(screen.getByRole("button", { name: /Add alert/ }));

        expect(host.alertAuthorings).toEqual([
          { graphId: "graph_123", seriesName: "0/latency/p95" },
        ]);
      });
    });
  });

  describe("given an active trigger is configured for this graph", () => {
    describe("when the bell icon is clicked", () => {
      it("opens automation's drawer in edit mode for that trigger and its first series", () => {
        const host = renderHeader({
          trigger: { id: "trigger_1", active: true, alertType: "WARNING" },
        });

        fireEvent.click(screen.getByRole("button", { name: "Edit alert" }));

        expect(host.alertAuthorings).toEqual([
          { graphId: "graph_123", automationId: "trigger_1", seriesName: "0/latency/p95" },
        ]);
      });
    });
  });
});
