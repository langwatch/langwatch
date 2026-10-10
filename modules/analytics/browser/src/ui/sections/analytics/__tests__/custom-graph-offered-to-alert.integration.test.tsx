/**
 * @vitest-environment jsdom
 * The graph composer and the automation drawer read one `graphs.getAll` list: saving a graph
 * must leave it current, or the graph just made is missing from the alert the author came to write.
 * @see specs/automations/authoring-drawer.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../../testing.tsx";

type Graph = { id: string; name: string };

type GraphListState = {
  /** The graphs the project holds, as the server would answer. */
  serverGraphs: Graph[];
  /** The copy the app shows; invalidating `graphs.getAll` moves the server's list into it. */
  cachedGraphs: Graph[];
  getAllInvalidations: number;
};

const { state } = vi.hoisted(() => {
  const state: GraphListState = { serverGraphs: [], cachedGraphs: [], getAllInvalidations: 0 };
  return { state };
});

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({
      graphs: {
        getById: { invalidate: async () => undefined },
        getAll: {
          invalidate: async () => {
            state.getAllInvalidations += 1;
            state.cachedGraphs = state.serverGraphs;
          },
        },
      },
    }),
    graphs: {
      create: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: { name?: string }, options?: { onSuccess?: () => void }) => {
            state.serverGraphs = [
              ...state.serverGraphs,
              { id: "graph-new", name: input.name ?? "" },
            ];
            options?.onSuccess?.();
          },
        }),
      },
      updateById: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      getById: { useQuery: () => ({ data: undefined, isLoading: false, error: null }) },
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

import CustomGraphScreen from "../custom-graph.screen.tsx";

beforeEach(() => {
  state.serverGraphs = [];
  state.cachedGraphs = [];
  state.getAllInvalidations = 0;
});

afterEach(() => cleanup());

describe("Creating a custom graph then alerting on it", () => {
  describe("given the composer has just saved a new graph", () => {
    describe("when the author starts a new alert in the same session", () => {
      /** @scenario "A newly created graph is offered to a new alert without reloading" */
      it("refreshes the graph list every picker reads, so the new graph is on offer", async () => {
        const host = new StubAnalyticsHost();
        render(
          <AnalyticsTestHarness host={host}>
            <CustomGraphScreen mode="new" />
          </AnalyticsTestHarness>,
        );

        await userEvent.click(screen.getByRole("button", { name: "Save" }));

        const [createdGraph] = state.serverGraphs;
        if (!createdGraph) throw new Error("expected the created graph on the server");
        expect(state.getAllInvalidations).toBe(1);
        expect(state.cachedGraphs).toContainEqual(createdGraph);
      });
    });
  });
});
