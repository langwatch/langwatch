/**
 * @vitest-environment jsdom
 * A widget's runs say which widget they are for, and a re-render that builds the same ids afresh
 * keeps the run the frame was handed, so its queries are not started over.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../../dashboards/__tests__/render-dashboards.test-helpers.tsx";
import { useDashboardWidgetExecutor } from "../use-dashboard-widget-executor.ts";

const QUERIES = [{ name: "main", sql: "SELECT 1" }];
const WINDOW = { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 9, 2) };

afterEach(cleanup);

describe("given a placed widget whose card re-renders with the same ids", () => {
  /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
  it("keeps the run it handed the frame, and sends the widget's ids with it", async () => {
    const user = userEvent.setup();
    const calls: UiProcedureCall[] = [];
    const runs: unknown[] = [];
    function Card() {
      const [renders, setRenders] = useState(0);
      // Built afresh on every render, as a card does.
      const { executeQuery } = useDashboardWidgetExecutor("project-1", QUERIES, {
        timeWindow: WINDOW,
        telemetry: { dashboardId: "board-1", widgetId: "widget-1" },
      });
      runs.push(executeQuery);
      return (
        <button type="button" onClick={() => setRenders(renders + 1)}>
          Render again
        </button>
      );
    }
    renderDashboards({
      element: <Card />,
      host: new StubAnalyticsHost(),
      answer: (call) => {
        calls.push(call);
        if (call.path !== "analytics.lwql.query") return NO_PROCEDURES(call);
        return Promise.resolve({
          columns: [],
          rows: [],
          statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
          diagnostics: [],
          followsTimeWindow: false,
          followsGranularity: false,
        });
      },
    });

    await user.click(screen.getByRole("button", { name: "Render again" }));

    expect(runs.length).toBeGreaterThan(1);
    expect(new Set(runs).size).toBe(1);
    const run = runs[0] as ReturnType<typeof useDashboardWidgetExecutor>["executeQuery"];
    await act(() => run({ queryName: "main", params: {}, signal: new AbortController().signal }));
    expect(calls.find(({ path }) => path === "analytics.lwql.query")?.input).toMatchObject({
      telemetry: { dashboardId: "board-1", widgetId: "widget-1" },
    });
  });
});
