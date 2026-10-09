/**
 * @vitest-environment jsdom
 * The evidence chart analytics lends an insight card, over the real tRPC hooks: what it
 * asks the query door for, and what a reader the door refuses is shown.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { UiProcedureRefusal, type UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Vega does nothing useful under jsdom; the marker echoes the rows the chart was handed.
vi.mock("../langwatch-ql-widget-chart.tsx", () => ({
  default: ({ rows, ariaLabel }: { rows: readonly unknown[]; ariaLabel: string }) => (
    <figure aria-label={ariaLabel} data-testid="replay-chart">
      {JSON.stringify(rows)}
    </figure>
  ),
}));

import { StubAnalyticsHost } from "../../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../../../dashboards/__tests__/render-dashboards.test-helpers.tsx";
import { LwqlReplayChart } from "../lwql-replay-chart.tsx";

const SQL =
  "SELECT count() AS errors FROM traces WHERE model = {model:String} " +
  "AND started_at >= {dashboard_context_period_start:DateTime}";
const WINDOW = {
  start: Date.UTC(2026, 6, 5),
  end: Date.UTC(2026, 7, 4),
  granularitySeconds: 86_400,
};
const ROWS = [{ errors: 42 }];
const RESULT = {
  columns: [{ name: "errors", type: "UInt64" }],
  rows: ROWS,
  statistics: { elapsedMs: 1, rowsRead: 1, bytesRead: 1 },
  diagnostics: [],
  followsTimeWindow: true,
  followsGranularity: false,
};

function renderReplay({ door }: { door: () => Promise<unknown> }) {
  const runs: UiProcedureCall[] = [];
  renderDashboards({
    element: (
      <LwqlReplayChart
        sql={SQL}
        window={WINDOW}
        parameters={{ model: "gpt-5" }}
        name="Errors by day"
      />
    ),
    host: new StubAnalyticsHost(),
    answer: (call) => {
      if (call.path !== "analytics.lwql.query") return NO_PROCEDURES(call);
      runs.push(call);
      return door();
    },
  });
  return { runs };
}

afterEach(cleanup);

describe("given an insight with a query and a window from Jul 5 to Aug 3", () => {
  describe("when a member opens the card", () => {
    /** @scenario "The card replays the query over the window it was filed with" */
    it("runs the statement as kept, with the window and values bound beside it", async () => {
      const { runs } = renderReplay({ door: () => Promise.resolve(RESULT) });

      expect(await screen.findByRole("figure", { name: "Errors by day" })).toHaveTextContent(
        JSON.stringify(ROWS),
      );
      expect(runs).toHaveLength(1);
      expect(runs[0]?.input).toEqual({
        projectId: "proj-1",
        sql: SQL,
        parameters: { model: "gpt-5" },
        timeWindow: { start: "2026-07-05T00:00:00.000Z", end: "2026-08-04T00:00:00.000Z" },
        granularitySeconds: 86_400,
      });
    });
  });
});

describe("given an insight whose query the reader may not run", () => {
  describe("when the card replays the query", () => {
    /** @scenario "A reader the query is refused for sees the refusal, not the numbers" */
    it("shows the refusal the query door gave and draws no chart", async () => {
      const { runs } = renderReplay({
        door: () => Promise.reject(new UiProcedureRefusal("lwql_not_permitted", 403)),
      });

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(screen.queryByTestId("replay-chart")).not.toBeInTheDocument();
    });
  });
});
