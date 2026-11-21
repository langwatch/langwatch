/**
 * @vitest-environment jsdom
 * A card re-rendered over the same window pushes its frame no new dashboard context, so a widget
 * that refetches on a context change does not loop; a refresh that moves the window pushes one.
 * The real card, executor and sandboxed frame run; only the frame's window is stood in for.
 * @see modules/dashboard/specs/dashboards-v2.feature AC19d
 */

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom loads no stylesheet, so the theme colours a chart frame is handed have no value to read.
vi.mock(import("@langwatch/design-system/color-mode"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRawColorValue: () => "#123456",
}));

import { StubAnalyticsHost } from "../../../testing.tsx";
import type { BoardPeriod } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";
import { BoardWidgetCard } from "../ui/sections/board-widget-card.tsx";
import {
  NO_PROCEDURES,
  recordWidgetFrames,
  renderDashboards,
} from "./render-dashboards.test-helpers.tsx";

const PERIOD: BoardPeriod = {
  periodStart: Date.UTC(2026, 9, 1),
  periodEnd: Date.UTC(2026, 9, 31),
  granularitySeconds: 86_400,
};
const REFRESHED_END = PERIOD.periodEnd + 60_000;

/** The widget row, built afresh on each call as a refetched board list hands it over. */
const placedWidget = (): BoardWidget => ({
  id: "w-1",
  name: "Traces",
  definition: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "traces", sql: "SELECT count() AS n FROM traces" }],
  },
  placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
});

/** The card as a board draws it, with buttons standing in for a re-render and a refresh. */
function BoardCard() {
  const [widget, setWidget] = useState(placedWidget);
  const [period, setPeriod] = useState(PERIOD);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setWidget(placedWidget());
          setPeriod({ ...PERIOD });
        }}
      >
        Render again
      </button>
      <button type="button" onClick={() => setPeriod({ ...PERIOD, periodEnd: REFRESHED_END })}>
        Refresh now
      </button>
      <BoardWidgetCard
        widget={widget}
        projectId="proj-1"
        projectSlug="test-project"
        dashboardId="board-1"
        boardName="Weekly review"
        period={period}
        periodKey="30d:auto"
        isWriting={false}
      />
    </>
  );
}

/** Lets the frame's queued animation frame post its context, and the port carry it. */
const afterNextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));

afterEach(cleanup);

describe("given a widget card on a board", () => {
  describe("when it re-renders over the same window, then a refresh moves its end", () => {
    /** @scenario "AC19d A fixed range moves its end to now on each refresh" */
    it("pushes its frame one context change, for the refresh only", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const frames = recordWidgetFrames();
      try {
        renderDashboards({
          element: <BoardCard />,
          host: new StubAnalyticsHost(),
          answer: NO_PROCEDURES,
        });
        const iframe = await screen.findByTitle("Custom chart");
        // The mount's own push finds no port yet; the frame loads after it.
        await afterNextFrame();
        frames.loadAll([iframe]);
        await afterNextFrame();

        // A fresh row and period object of equal value re-render the whole card.
        await user.click(screen.getByRole("button", { name: "Render again" }));
        await afterNextFrame();
        await user.click(screen.getByRole("button", { name: "Refresh now" }));

        // The port is ordered: a push from the re-render would arrive before the refresh's.
        await waitFor(() =>
          expect(frames.contextChanges().at(-1)?.timeWindow.end).toBe(REFRESHED_END),
        );
        expect(frames.contextChanges().map(({ timeWindow }) => timeWindow)).toEqual([
          { start: PERIOD.periodStart, end: REFRESHED_END },
        ]);
        expect(screen.getByTitle("Custom chart")).toBe(iframe);
      } finally {
        frames.restore();
      }
    });
  });
});
