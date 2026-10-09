/**
 * @vitest-environment jsdom
 * Where an insight came from and the evidence under it, on the Insights page: what the row
 * says itself, and what it hands the trail and the chart analytics lends.
 * @see modules/insight/specs/insight-inbox.feature
 */

import {
  DashboardPointerToken,
  type DashboardPointerProps,
  LwqlReplayChartToken,
  type LwqlReplayChartProps,
} from "@langwatch/analytics-client";
import type { UiLend } from "@langwatch/browser-host/declarations";
import type { InsightEntry } from "@langwatch/insight-contract";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { insightEntry, renderWithInsightHost } from "../../../testing.tsx";
import InsightsScreen from "../insights.screen.tsx";

const BOARD = {
  id: "board-1",
  name: "Checkout health",
  widget: { id: "widget-1", name: "Errors by day" },
};
const QUERY = "SELECT count() FROM traces WHERE model = {model:String}";
const REPLAY = {
  start: new Date(2026, 6, 5).getTime(),
  end: new Date(2026, 7, 4).getTime(),
  granularitySeconds: 86_400,
  period: "Last 30 days",
  parameters: { model: "gpt-5" },
};

/** Stand-ins for what analytics lends: each prints the props it was handed. */
const ANALYTICS_LENDS: readonly UiLend[] = [
  {
    token: DashboardPointerToken,
    load: async () => ({
      default: (props: DashboardPointerProps) => (
        <span data-testid="lent-trail">{JSON.stringify(props)}</span>
      ),
    }),
  },
  {
    token: LwqlReplayChartToken,
    load: async () => ({
      default: (props: LwqlReplayChartProps) => (
        <span data-testid="lent-chart">{JSON.stringify(props)}</span>
      ),
    }),
  },
];

function renderInbox({ entry, lends }: { entry: InsightEntry; lends?: readonly UiLend[] }) {
  return renderWithInsightHost({
    element: <InsightsScreen />,
    answer: (call) => {
      if (call.path === "insights.getAll") return Promise.resolve([entry]);
      if (call.path === "insights.markSeen") return Promise.resolve(null);
      return Promise.reject(new Error(`No test answer for ${call.path}`));
    },
    ...(lends ? { lends } : {}),
  });
}

async function row() {
  return within(await screen.findByRole("article", { name: "Checkout errors doubled" }));
}

describe("given an insight that came from a widget on a board", () => {
  const entry = insightEntry({ board: BOARD });

  describe("when a member reads the row and analytics lends the trail", () => {
    /** @scenario "The row shows the board and the widget an insight came from" */
    it("hands the trail the board and the widget, ids and names", async () => {
      renderInbox({ entry, lends: ANALYTICS_LENDS });

      const trail = await (await row()).findByTestId("lent-trail");

      expect(JSON.parse(trail.textContent ?? "")).toEqual({
        boardId: "board-1",
        boardName: "Checkout health",
        widget: { id: "widget-1", name: "Errors by day" },
      });
    });
  });

  describe("when nothing draws the trail", () => {
    /** @scenario "The row shows the board and the widget an insight came from" */
    it("reads the names as they were filed, with no link", async () => {
      renderInbox({ entry });

      const origin = (await row()).getByTestId("insight-origin");

      expect(origin).toHaveTextContent("Checkout health › Errors by day");
      expect(within(origin).queryByRole("link")).not.toBeInTheDocument();
    });
  });
});

describe("given an insight a member saved from a Langy answer", () => {
  describe("when a member reads the row", () => {
    /** @scenario "The row says how the insight was filed" */
    it("reads saved from a chat with Langy, and names no board when it has none", async () => {
      renderInbox({ entry: insightEntry({ filedVia: "chat" }) });

      expect((await row()).getByTestId("insight-origin")).toHaveTextContent(
        /^Saved from a chat with Langy$/,
      );
    });
  });

  describe("when the insight was filed by a run instead", () => {
    /** @scenario "The row says how the insight was filed" */
    it("reads daily run", async () => {
      renderInbox({ entry: insightEntry({ filedVia: "run", filedByUserId: null }) });

      expect((await row()).getByTestId("insight-origin")).toHaveTextContent(/^Daily run$/);
    });
  });
});

describe("given an insight from a board with a query, a window from Jul 5 to Aug 3 and the period Last 30 days", () => {
  const entry = insightEntry({ board: BOARD, lwql: QUERY, replay: REPLAY });

  describe("when a member opens the card", () => {
    /** @scenario "The card says which dates and values the evidence was replayed with" */
    it("hands the chart the query, the window and the values, and says so under it", async () => {
      renderInbox({ entry, lends: ANALYTICS_LENDS });

      const evidence = within(await (await row()).findByRole("figure", { name: "Evidence" }));
      const chart = await evidence.findByTestId("lent-chart");

      expect(JSON.parse(chart.textContent ?? "")).toEqual({
        sql: QUERY,
        window: { start: REPLAY.start, end: REPLAY.end, granularitySeconds: 86_400 },
        parameters: { model: "gpt-5" },
        name: "Errors by day",
      });
      expect(
        evidence.getByText(
          "Replayed with: Jul 5 to Aug 3 · Last 30 days · model: gpt-5. " +
            "The board as it was set when Langy filed this.",
        ),
      ).toBeInTheDocument();
    });
  });
});

describe("given an insight filed with a query and no window", () => {
  describe("when a member opens the card", () => {
    /** @scenario "An insight with no window draws no evidence" */
    it("draws no chart and no line about a replay", async () => {
      renderInbox({ entry: insightEntry({ lwql: QUERY }), lends: ANALYTICS_LENDS });

      const card = await row();

      expect(card.queryByRole("figure", { name: "Evidence" })).not.toBeInTheDocument();
      expect(card.queryByTestId("lent-chart")).not.toBeInTheDocument();
      expect(card.queryByText(/Replayed with/)).not.toBeInTheDocument();
    });
  });
});
