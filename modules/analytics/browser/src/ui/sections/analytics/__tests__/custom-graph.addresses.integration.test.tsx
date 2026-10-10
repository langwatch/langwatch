/**
 * @vitest-environment jsdom
 * Main served the chart builder at `/analytics/custom` for a new graph; the
 * declaration answers that address with the builder in its new mode.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../../testing.tsx";

const { reads, stored } = vi.hoisted(() => ({
  reads: { getById: 0 },
  stored: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({ graphs: { getById: { invalidate: async () => undefined } } }),
    graphs: {
      create: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      updateById: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      getById: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => {
          if (options.enabled) reads.getById += 1;
          return {
            data: options.enabled ? stored.current : undefined,
            isLoading: false,
            error: null,
          };
        },
      },
    },
    analytics: {
      dataForFilter: { useQuery: () => ({ data: { options: [] }, isLoading: false }) },
    },
  },
}));

vi.mock("../../custom-graph.tsx", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CustomGraph: () => null,
}));
vi.mock("../../filter-sidebar.tsx", () => ({ FilterSidebar: () => null }));
vi.mock("../../saved-views-scope.tsx", () => ({
  SavedViewsScope: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../analytics-period-picker.tsx", () => ({ AnalyticsPeriodPicker: () => null }));

import { analyticsWeb } from "../../../../analytics.web.ts";

async function loadScreen(page: string): Promise<ComponentType> {
  const loaded = await analyticsWeb.installation.screens[page]?.load?.();
  const component = (loaded as { default?: ComponentType } | undefined)?.default;
  if (!component) throw new Error(`${page} declares no screen`);
  return component;
}

afterEach(() => {
  cleanup();
  reads.getById = 0;
  stored.current = undefined;
});

describe("given the custom graph address with no graph id", () => {
  describe("when the browser opens it", () => {
    /** @scenario "The chart builder is told which of its two addresses it is" */
    it("renders the chart builder for a new graph without reading a stored one", async () => {
      const NewGraphScreen = await loadScreen("pages/[project]/analytics/custom/index");

      render(
        <AnalyticsTestHarness host={new StubAnalyticsHost({ route: { params: {}, query: {} } })}>
          <NewGraphScreen />
        </AnalyticsTestHarness>,
      );

      expect(await screen.findByRole("button", { name: "Add Series" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      expect(reads.getById).toBe(0);
      expect(screen.getByTestId("analytics-graph-title")).not.toHaveValue("Latency by model");
    });
  });
});

describe("given the custom graph address naming a graph", () => {
  describe("when the browser opens it", () => {
    /** @scenario "The chart builder is told which of its two addresses it is" */
    it("opens the builder on that stored graph", async () => {
      stored.current = {
        name: "Latency by model",
        graph: {
          graphType: "line",
          includePrevious: false,
          timeScale: 1,
          series: [
            {
              name: "Completion time p95",
              colorSet: "blueTones",
              metric: "performance.completion_time",
              aggregation: "p95",
            },
          ],
        },
      };
      const EditGraphScreen = await loadScreen("pages/[project]/analytics/custom/[id]");

      render(
        <AnalyticsTestHarness
          host={new StubAnalyticsHost({ route: { params: { id: "graph_1" }, query: {} } })}
        >
          <EditGraphScreen />
        </AnalyticsTestHarness>,
      );

      expect(reads.getById).toBeGreaterThan(0);
      expect(await screen.findByDisplayValue("Latency by model")).toBeInTheDocument();
      expect(await screen.findByDisplayValue("Completion time p95")).toBeInTheDocument();
    });
  });
});
