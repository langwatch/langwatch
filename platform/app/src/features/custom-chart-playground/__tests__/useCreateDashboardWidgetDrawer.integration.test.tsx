/**
 * @vitest-environment jsdom
 *
 * The period the "Add chart" draft previews against.
 *
 * A placed widget reads the dashboard's period control (see
 * DashboardWidgetFrame.integration.test.tsx). The draft must read the same
 * control, or the preview answers for a fixed last 24 hours while the card it
 * becomes answers for the dashboard's period, and a member sees "0 rows" for
 * a query that shows data once saved.
 *
 * `useWidgetPreview` is mocked to a spy: the claim is which `timeWindow` the
 * create drawer hands the preview.
 *
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { periodMock, previewMock } = vi.hoisted(() => ({
  periodMock: vi.fn(),
  previewMock: vi.fn(),
}));

vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => periodMock(),
}));

vi.mock("../useWidgetPreview", () => ({
  useWidgetPreview: (args: unknown) => {
    previewMock(args);
    return { resetPreview: vi.fn() };
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    dashboardWidgets: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

import { useCreateDashboardWidgetDrawer } from "../useCreateDashboardWidgetDrawer";

const lastPreviewWindow = () =>
  (previewMock.mock.calls.at(-1)?.[0] as { timeWindow?: unknown }).timeWindow;

const render = () =>
  renderHook(() =>
    useCreateDashboardWidgetDrawer({
      open: true,
      onClose: vi.fn(),
      projectId: "project_1",
      projectSlug: "project-1",
      dashboardId: "dashboard_1",
    }),
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe("given a dashboard showing the last 30 days", () => {
  describe("when a member opens Add chart", () => {
    /** @scenario "A new widget previews against the dashboard's period" */
    it("previews the draft against the dashboard's own period", () => {
      const end = Date.UTC(2026, 8, 26);
      const start = end - 30 * 24 * 60 * 60 * 1000;
      periodMock.mockReturnValue({
        period: { startDate: new Date(start), endDate: new Date(end) },
      });

      render();

      expect(lastPreviewWindow()).toEqual({ start, end });
    });
  });
});
