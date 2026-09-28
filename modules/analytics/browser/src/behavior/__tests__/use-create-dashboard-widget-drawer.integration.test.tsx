/**
 * @vitest-environment jsdom
 * The draft previews against the dashboard's own period control, the window a
 * placed widget runs in, so the preview and the saved card agree.
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { periodMock, previewMock } = vi.hoisted(() => ({
  periodMock: vi.fn(),
  previewMock: vi.fn<(args: { timeWindow?: { start: number; end: number } }) => void>(),
}));

vi.mock("@langwatch/analytics-browser-kit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePeriodSelector: () => periodMock(),
}));

vi.mock("../use-widget-preview.ts", () => ({
  useWidgetPreview: (args: { timeWindow?: { start: number; end: number } }) => {
    previewMock(args);
    return { resetPreview: vi.fn() };
  },
}));

vi.mock("../analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({}),
    dashboardWidgets: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("../analytics-feedback.ts", () => ({ useShowErrorToast: () => vi.fn() }));

import { useCreateDashboardWidgetDrawer } from "../use-create-dashboard-widget-drawer.ts";

const lastPreviewWindow = () => previewMock.mock.calls.at(-1)?.[0].timeWindow;

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
        period: { startDate: { epochMilliseconds: start }, endDate: { epochMilliseconds: end } },
      });

      render();

      expect(lastPreviewWindow()).toEqual({ start, end });
    });
  });
});
