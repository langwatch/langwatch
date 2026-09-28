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

const { reads } = vi.hoisted(() => ({ reads: { getById: 0 } }));

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({ graphs: { getById: { invalidate: async () => undefined } } }),
    graphs: {
      create: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      updateById: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      getById: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => {
          if (options.enabled) reads.getById += 1;
          return { data: undefined, isLoading: false, error: null };
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
});

describe("given the custom graph address with no graph id", () => {
  describe("when the browser opens it", () => {
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
    });
  });
});

describe("given the custom graph address naming a graph", () => {
  describe("when the browser opens it", () => {
    it("reads that stored graph", async () => {
      const EditGraphScreen = await loadScreen("pages/[project]/analytics/custom/[id]");

      render(
        <AnalyticsTestHarness
          host={new StubAnalyticsHost({ route: { params: { id: "graph_1" }, query: {} } })}
        >
          <EditGraphScreen />
        </AnalyticsTestHarness>,
      );

      expect(reads.getById).toBeGreaterThan(0);
    });
  });
});
