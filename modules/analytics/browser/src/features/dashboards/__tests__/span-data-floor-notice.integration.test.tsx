/**
 * @vitest-environment jsdom
 * A span widget on a board says where span history starts when its period begins earlier. The
 * floor is what the server reports, the span replay's recorded since. Only the sandboxed frame
 * is stood in for, since jsdom cannot run it.
 * @see specs/lwql/stock-widgets-read-no-map.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: () => <div data-testid="sandboxed-frame" />,
}));

import { StubAnalyticsHost } from "../../../testing.tsx";
import type { BoardPeriod } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";
import { BoardWidgetCard } from "../ui/sections/board-widget-card.tsx";
import { renderDashboards } from "./render-dashboards.test-helpers.tsx";

const PERIOD: BoardPeriod = {
  periodStart: Date.UTC(2026, 9, 1),
  periodEnd: Date.UTC(2026, 9, 31),
  granularitySeconds: 86_400,
};
const SPAN_SQL = "SELECT ErrorType, count() AS n FROM span_metrics GROUP BY ErrorType";
const TRACE_SQL = "SELECT count() AS n FROM trace_metrics";

const widgetWith = (sql: string): BoardWidget => ({
  id: "w-1",
  name: "Errors by type",
  definition: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql }],
  },
  placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
});

/** A door that answers the floor with `from` and records every path it is asked. */
function floorDoor(from: string | null, rebuilding: boolean) {
  const asked: string[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    asked.push(call.path);
    if (call.path === "analytics.lwql.spanDataFloor") return Promise.resolve({ from, rebuilding });
    return new Promise(() => undefined);
  };
  return { answer, asked };
}

function renderCard({
  sql,
  from,
  rebuilding = false,
}: {
  sql: string;
  from: string | null;
  rebuilding?: boolean;
}) {
  const door = floorDoor(from, rebuilding);
  renderDashboards({
    element: (
      <BoardWidgetCard
        widget={widgetWith(sql)}
        projectId="proj-1"
        projectSlug="test-project"
        dashboardId="board-1"
        boardName="Weekly review"
        period={PERIOD}
        periodKey="30d:auto"
        isWriting={false}
      />
    ),
    host: new StubAnalyticsHost(),
    answer: door.answer,
  });
  return door;
}

afterEach(cleanup);

describe("given a widget that reads span_metrics", () => {
  describe("when its period starts before the recorded span floor", () => {
    /** @scenario "A span widget whose period starts before the span data says where it starts" */
    it("shows the day span data starts from", async () => {
      renderCard({ sql: SPAN_SQL, from: "2026-10-10T08:30:00Z" });

      expect(await screen.findByTestId("widget-span-floor-notice")).toHaveTextContent(
        "Span data from 10 Oct 2026",
      );
    });
  });

  describe("when its period starts after the recorded span floor", () => {
    /** @scenario "A span widget whose period starts after the floor shows no notice" */
    it("shows no notice", async () => {
      const door = renderCard({ sql: SPAN_SQL, from: "2026-09-01T00:00:00Z" });

      await waitFor(() => expect(door.asked).toContain("analytics.lwql.spanDataFloor"));
      expect(screen.queryByTestId("widget-span-floor-notice")).toBeNull();
    });
  });

  describe("when the span replay has not started yet", () => {
    /** @scenario "A span widget says its history is still being rebuilt before the replay starts" */
    it("says span history is still being rebuilt", async () => {
      renderCard({ sql: SPAN_SQL, from: null, rebuilding: true });

      expect(await screen.findByTestId("widget-span-floor-notice")).toHaveTextContent(
        "Span history is still being rebuilt",
      );
    });
  });
});

describe("given a widget that reads no span_metrics", () => {
  it("never asks for the span floor", async () => {
    const door = renderCard({ sql: TRACE_SQL, from: "2026-10-10T08:30:00Z" });

    await screen.findByTestId("sandboxed-frame");
    expect(door.asked).not.toContain("analytics.lwql.spanDataFloor");
    expect(screen.queryByTestId("widget-span-floor-notice")).toBeNull();
  });
});
