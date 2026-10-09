/**
 * @vitest-environment jsdom
 * An aggregate refuses a new chart (ADR-177), so its reports and the chart editor, reached by a
 * direct link, offer neither "Add chart" nor Save. A save the server refuses on any project
 * reports the server's reason and leaves the editor open.
 * @see specs/governance/aggregate-project.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../../testing.tsx";

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({
      graphs: {
        getById: { invalidate: async () => undefined },
        getAll: { invalidate: async () => undefined },
      },
    }),
    graphs: {
      create: {
        useMutation: () => ({
          isPending: false,
          mutate: (_input: unknown, options?: { onError?: (error: unknown) => void }) => {
            options?.onError?.(READ_ONLY_REFUSAL);
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

import AnalyticsReportsScreen from "../analytics-reports.screen.tsx";
import CustomGraphScreen from "../custom-graph.screen.tsx";

/** A save the server refused as read only, as the tRPC client receives it. */
const READ_ONLY_REFUSAL = {
  message: "aggregate_project_is_read_only",
  data: {
    error: {
      code: "aggregate_project_is_read_only",
      httpStatus: 403,
      fault: "customer",
      meta: {},
      tips: [],
      reasons: [],
    },
  },
};

const projectOfKind = (kind: string) => ({
  id: "proj-1",
  slug: "proj",
  name: "Proj",
  hasFirstMessage: true,
  kind,
});

afterEach(() => cleanup());

describe("Adding a chart", () => {
  describe("given an aggregate project opened by a direct link", () => {
    describe("when ana opens its reports or the chart editor", () => {
      /** @scenario "The aggregate's reports offer no chart to add" */
      it("offers neither Add chart nor Save", () => {
        const host = new StubAnalyticsHost({ project: projectOfKind("aggregate") });

        render(
          <AnalyticsTestHarness host={host}>
            <AnalyticsReportsScreen />
            <CustomGraphScreen mode="new" />
          </AnalyticsTestHarness>,
        );

        expect(screen.queryByText(/Add chart/)).toBeNull();
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      });
    });
  });

  describe("given a project whose server refuses the new chart", () => {
    describe("when ana saves it from the chart editor", () => {
      /** @scenario "A chart save the server refuses says why" */
      it("reports the server's refusal and stays on the editor", async () => {
        const host = new StubAnalyticsHost({ project: projectOfKind("application") });

        render(
          <AnalyticsTestHarness host={host}>
            <CustomGraphScreen mode="new" />
          </AnalyticsTestHarness>,
        );
        await userEvent.click(await screen.findByRole("button", { name: "Save" }));

        await waitFor(() => expect(host.failures).toHaveLength(1));
        expect(host.failures[0]?.error).toBe(READ_ONLY_REFUSAL);
        expect(host.navigations).toEqual([]);
      });
    });
  });
});
