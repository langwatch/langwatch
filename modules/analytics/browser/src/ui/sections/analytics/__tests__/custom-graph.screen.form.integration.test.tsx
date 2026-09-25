/**
 * @vitest-environment jsdom
 * The custom graph form: the title it suggests from the series and grouping,
 * and the reports page it returns to after saving or cancelling.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../../testing.tsx";

type Recorded = { input: Record<string, unknown> };

const { created } = vi.hoisted(() => {
  const created: Recorded[] = [];
  return { created };
});

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({ graphs: { getById: { invalidate: async () => undefined } } }),
    graphs: {
      create: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: Record<string, unknown>, options?: { onSuccess?: () => void }) => {
            created.push({ input });
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
vi.mock("../../analytics-period-picker.tsx", () => ({ AnalyticsPeriodPicker: () => null }));

import CustomGraphScreen from "../custom-graph.screen.tsx";

function renderNewGraph(query: Record<string, string> = {}) {
  const host = new StubAnalyticsHost({ route: { params: {}, query } });
  render(
    <AnalyticsTestHarness host={host}>
      <CustomGraphScreen mode="new" />
    </AnalyticsTestHarness>,
  );
  return host;
}

beforeEach(() => {
  created.length = 0;
});

afterEach(() => cleanup());

describe("CustomGraphScreen form", () => {
  describe("when a new graph is saved from a dashboard", () => {
    it("names it after its series and returns to that dashboard", async () => {
      const host = renderNewGraph({ dashboard: "dash_1" });

      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(created[0]?.input).toMatchObject({ name: "Traces count", dashboardId: "dash_1" });
      expect(host.navigations).toEqual(["/test-project/analytics/reports?dashboard=dash_1"]);
    });
  });

  describe("when a new graph is saved without a dashboard", () => {
    it("returns to the reports page", async () => {
      const host = renderNewGraph();

      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(host.navigations).toEqual(["/test-project/analytics/reports"]);
    });
  });

  describe("when the form is cancelled", () => {
    it("returns to the dashboard it came from", async () => {
      const host = renderNewGraph({ dashboard: "dash_1" });

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(host.navigations).toEqual(["/test-project/analytics/reports?dashboard=dash_1"]);
    });
  });

  describe("when the graph is grouped", () => {
    it("suggests a title naming the grouping", async () => {
      renderNewGraph();
      const groupBy = screen.getByDisplayValue("No grouping");
      const firstGroup = groupBy.querySelector("optgroup option");
      if (!(firstGroup instanceof HTMLOptionElement)) throw new Error("no grouping options");

      await userEvent.selectOptions(groupBy, firstGroup.value);
      await waitFor(() =>
        expect(screen.getByDisplayValue(/^Traces count per /i)).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(created[0]?.input.name).toMatch(
        new RegExp(`^Traces count per ${firstGroup.textContent}$`, "i"),
      );
    });
  });
});
