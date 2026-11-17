/**
 * @vitest-environment jsdom
 * A widget on a board that reads LastUsedPromptVersionId mounts its body only once its rows
 * cannot be wrong; otherwise a notice stands in its place. Only the sandboxed frame is stood in
 * for, since jsdom cannot run it.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
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

const FLOOR_PATH = "analytics.lwql.managedPromptVersionFloor";
/** November; with the 30 days before it, att-change's window starts on 2 Oct 2026. */
const PERIOD: BoardPeriod = {
  periodStart: Date.UTC(2026, 10, 1),
  periodEnd: Date.UTC(2026, 11, 1),
  granularitySeconds: 86_400,
};
const VERSION_SQL =
  "SELECT LastUsedPromptVersionId AS version, count() AS n FROM trace_metrics GROUP BY version";
const TRACE_SQL = "SELECT count() AS n FROM trace_metrics";

type Floor = { from: string | null; rebuilding: boolean; unknown: boolean };
type FloorAnswer = Floor | "loading" | "failed";

const widgetWith = (sql: string): BoardWidget => ({
  id: "w-1",
  name: "Prompt version changes",
  definition: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql }],
  },
  placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
});

/** A door that answers the floor as told and records every path it is asked. */
function floorDoor(floor: FloorAnswer) {
  const asked: string[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    asked.push(call.path);
    if (call.path !== FLOOR_PATH || floor === "loading") return new Promise(() => undefined);
    if (floor === "failed") return Promise.reject(new Error("floor read failed"));
    return Promise.resolve(floor);
  };
  return { answer, asked };
}

function renderCard({ sql = VERSION_SQL, floor }: { sql?: string; floor: FloorAnswer }) {
  const door = floorDoor(floor);
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

/** The notice the card shows in place of the widget's body, which it never mounts. */
async function noticeInPlaceOfBody() {
  const notice = await screen.findByTestId("widget-prompt-version-notice");
  expect(screen.queryByTestId("sandboxed-frame")).toBeNull();
  return notice;
}

afterEach(cleanup);

describe("given a widget that reads LastUsedPromptVersionId", () => {
  describe("when the replay has not finished", () => {
    /** @scenario "A widget reading the managed version says history is rebuilding until the replay is done" */
    it("says history is being rebuilt and never mounts the body", async () => {
      renderCard({ floor: { from: null, rebuilding: true, unknown: false } });

      expect(await noticeInPlaceOfBody()).toHaveTextContent(
        "Prompt version history is still being rebuilt",
      );
    });
  });

  describe("when the replay is done and its since falls before the window", () => {
    it("mounts the body and shows no notice", async () => {
      renderCard({ floor: { from: "2026-10-01T00:00:00Z", rebuilding: false, unknown: false } });

      await screen.findByTestId("sandboxed-frame");
      expect(screen.queryByTestId("widget-prompt-version-notice")).toBeNull();
    });
  });

  describe("when the replay is done and its since falls inside the window", () => {
    /** @scenario "A period reaching before the replay's start says from when versions are known" */
    it("says from when versions are known and never mounts the body", async () => {
      renderCard({ floor: { from: "2026-10-10T08:30:00Z", rebuilding: false, unknown: false } });

      expect(await noticeInPlaceOfBody()).toHaveTextContent(
        "Prompt versions known from 10 Oct 2026",
      );
    });
  });

  describe("when the replay failed, or the floor cannot be read", () => {
    const unreadable: [string, FloorAnswer][] = [
      ["the ledger row is failed", { from: null, rebuilding: false, unknown: true }],
      ["the floor read fails", "failed"],
    ];

    /** @scenario "A replay that failed after its retries shows the history as unknown, never the rows" */
    it.each(unreadable)("says history is unknown when %s", async (_, floor) => {
      renderCard({ floor });

      expect(await noticeInPlaceOfBody()).toHaveTextContent("Prompt version history unknown");
    });
  });

  describe("when the replay was not needed", () => {
    it("mounts the body", async () => {
      renderCard({ floor: { from: null, rebuilding: false, unknown: false } });

      await screen.findByTestId("sandboxed-frame");
    });
  });

  describe("while the floor loads", () => {
    it("shows the loading face, no notice, and holds the body back", async () => {
      const door = renderCard({ floor: "loading" });

      await waitFor(() => expect(door.asked).toContain(FLOOR_PATH));
      expect(document.querySelector('[data-widget-state="loading"]')).not.toBeNull();
      expect(screen.queryByTestId("sandboxed-frame")).toBeNull();
      expect(screen.queryByTestId("widget-prompt-version-notice")).toBeNull();
    });
  });
});

describe("given a widget that reads no LastUsedPromptVersionId", () => {
  it("never asks for the floor", async () => {
    const door = renderCard({ sql: TRACE_SQL, floor: "loading" });

    await screen.findByTestId("sandboxed-frame");
    expect(door.asked).not.toContain(FLOOR_PATH);
  });
});
