/**
 * @vitest-environment jsdom
 * What a widget's run is keyed by: a new SQL statement starts the card over, so an earlier
 * answer, such as an empty one, is never shown for the new query. The real transport and
 * executor run; only the sandboxed frame is stood in for, since jsdom cannot run it.
 * @see modules/dashboard/specs/dashboards-v2.feature AC201d
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { frames } = vi.hoisted(() => ({
  frames: new WeakMap<Element, SandboxedChartFrameProps>(),
}));

vi.mock("../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: SandboxedChartFrameProps) => (
    <div
      data-testid="sandboxed-frame"
      ref={(element) => {
        if (element) frames.set(element, props);
      }}
    />
  ),
}));

import { StubAnalyticsHost } from "../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import type { BoardQueryContext } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";
import { BoardWidgetCard } from "../ui/sections/board-widget-card.tsx";
import { renderDashboards } from "./render-dashboards.test-helpers.tsx";

const PERIOD: BoardQueryContext = {
  periodStart: Date.UTC(2026, 9, 1),
  periodEnd: Date.UTC(2026, 9, 31),
  granularitySeconds: 86_400,
  excludeOrigins: [],
};
const CODE = "export default function Widget() { return null; }";
const OLD_SQL = "SELECT count() AS n FROM traces WHERE TraceName = 'langy.trun'";
const NEW_SQL = "SELECT count() AS n FROM traces WHERE TraceName = 'langy.turn'";
const widgetWith = (sql: string): BoardWidget => ({
  id: "w-1",
  name: "Langy requests",
  definition: { version: 1, code: CODE, queries: [{ name: "turns", sql }] },
  placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
});

/** The card as a board draws it, and a button standing in for a save that changed its SQL. */
function EditedCard() {
  const [widget, setWidget] = useState(() => widgetWith(OLD_SQL));
  return (
    <>
      <button type="button" onClick={() => setWidget(widgetWith(NEW_SQL))}>
        Save new SQL
      </button>
      <BoardWidgetCard
        widget={widget}
        projectId="proj-1"
        projectSlug="test-project"
        dashboardId="board-1"
        boardName="Weekly review"
        period={PERIOD}
        isWriting={false}
      />
    </>
  );
}

/** A query door that finds no rows for the old SQL and eleven for the new. */
function queryDoor() {
  const sent: string[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    if (call.path !== "analytics.lwql.query") {
      return Promise.reject(new Error(`No test answer for ${call.path}`));
    }
    const { sql } = call.input as { sql: string };
    sent.push(sql);
    return Promise.resolve({
      columns: [{ name: "n", type: "UInt64" }],
      rows: sql === NEW_SQL ? [{ n: 11 }] : [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
      diagnostics: [],
      followsTimeWindow: true,
      followsGranularity: true,
    });
  };
  return { answer, sent };
}

async function run(frame: Element) {
  const props = frames.get(frame);
  if (!props) throw new Error("the frame never rendered");
  let rows: readonly Record<string, unknown>[] | undefined;
  await act(async () => {
    rows = (
      await props.executeQuery({
        queryName: "turns",
        params: {},
        signal: new AbortController().signal,
      })
    ).rows;
  });
  return rows;
}

afterEach(cleanup);

describe("given a widget whose query returned no rows", () => {
  describe("when its SQL changes", () => {
    /** @scenario "AC201d Widget data: a changed query never shows an earlier answer" */
    it("starts the card over and runs the new SQL, never answering with the old rows", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const door = queryDoor();
      renderDashboards({
        element: <EditedCard />,
        host: new StubAnalyticsHost(),
        answer: door.answer,
      });
      const before = await screen.findByTestId("sandboxed-frame");
      const empty = await run(before);

      await user.click(screen.getByRole("button", { name: "Save new SQL" }));
      const after = screen.getByTestId("sandboxed-frame");
      const filled = await run(after);

      expect(after).not.toBe(before);
      expect(door.sent).toEqual([OLD_SQL, NEW_SQL]);
      expect({ empty, filled }).toEqual({ empty: [], filled: [{ n: 11 }] });
    });
  });
});
