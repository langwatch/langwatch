/**
 * @vitest-environment jsdom
 *
 * The create-drawer preview inherits the dashboard's period selector.
 *
 * When an author opens the "+ Add chart" drawer on a dashboard, the preview
 * they see must query the same time window the saved widget will query when
 * placed on the grid. Without this, a 0-row preview makes the query appear
 * broken, even though the placed card shows data.
 *
 * `useDashboardWidgetExecutor` is mocked to a spy: the claim here is which
 * `timeWindow` the drawer HANDS the executor, not what the executor does
 * with it.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { periodMock, executorMock } = vi.hoisted(() => ({
  periodMock: vi.fn(),
  executorMock: vi.fn(),
}));

vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => periodMock(),
}));

vi.mock("../useDashboardWidgetExecutor", () => ({
  useDashboardWidgetExecutor: (...args: unknown[]) => executorMock(...args),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      graphs: { getAll: { invalidate: vi.fn() } },
      dashboardWidgets: { list: { invalidate: vi.fn() } },
    }),
    dashboardWidgets: {
      create: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

import { useCreateDashboardWidgetDrawer } from "../useCreateDashboardWidgetDrawer";

const period = ({ startMs, endMs }: { startMs: number; endMs: number }) => ({
  period: { startDate: new Date(startMs), endDate: new Date(endMs) },
});

describe("useCreateDashboardWidgetDrawer", () => {
  const createExecutorReturnValue = (timeWindow: {
    start: number;
    end: number;
  }) => ({
    executeQuery: vi.fn(),
    runStandalone: vi.fn(),
    params: {
      timeWindow,
      granularitySeconds: 3600,
    },
    lastRuns: {},
    hostParams: {
      timeWindow,
      granularitySeconds: 3600,
    },
  });

  beforeEach(() => {
    periodMock.mockReset();
    executorMock.mockReset();
  });

  describe("when the drawer opens with a dashboard period selected", () => {
    /** @scenario "The create-drawer preview queries the dashboard's selected period" */
    it("hands the preview executor the dashboard's period as its time window", () => {
      periodMock.mockReturnValue(period({ startMs: 5_000, endMs: 10_000 }));
      executorMock.mockReturnValue(
        createExecutorReturnValue({ start: 5_000, end: 10_000 }),
      );

      renderHook(() =>
        useCreateDashboardWidgetDrawer({
          open: true,
          onClose: () => {},
          projectId: "project_1",
          projectSlug: "project",
          dashboardId: "dashboard_1",
        }),
      );

      // The preview executor must receive the dashboard period, not a hardcoded 24h window.
      expect(executorMock).toHaveBeenCalledWith(
        "project_1",
        expect.any(Array),
        {
          timeWindow: { start: 5_000, end: 10_000 },
        },
      );
    });

    /** @scenario "The create-drawer preview queries the dashboard's selected period" */
    it("reruns the preview's queries when the dashboard period changes while the drawer is open", () => {
      periodMock.mockReturnValue(period({ startMs: 5_000, endMs: 10_000 }));
      executorMock.mockReturnValue(
        createExecutorReturnValue({ start: 5_000, end: 10_000 }),
      );

      const { rerender } = renderHook(() =>
        useCreateDashboardWidgetDrawer({
          open: true,
          onClose: () => {},
          projectId: "project_1",
          projectSlug: "project",
          dashboardId: "dashboard_1",
        }),
      );

      periodMock.mockReturnValue(period({ startMs: 20_000, endMs: 30_000 }));
      executorMock.mockReturnValue(
        createExecutorReturnValue({ start: 20_000, end: 30_000 }),
      );

      rerender();

      expect(executorMock).toHaveBeenLastCalledWith(
        "project_1",
        expect.any(Array),
        {
          timeWindow: { start: 20_000, end: 30_000 },
        },
      );
    });
  });
});
