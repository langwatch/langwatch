/**
 * @vitest-environment jsdom
 * The board header's extension point: what a peer lends is drawn on a stored board and on a
 * From LangWatch board, and told which board it sits on.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { type BoardHeaderActionProps, BoardHeaderActionToken } from "@langwatch/analytics-client";
import { UiHostServicesContextProvider } from "@langwatch/browser-host/capabilities";
import { type UiLend, uiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import { curatedBoardById } from "../model/curated-boards.ts";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
const WIDGETS = ["Traces", "Cost"].map((name, index) => ({
  id: `widget-${index + 1}`,
  dashboardId: "board-1",
  name,
  graph: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql: "SELECT 1" }],
  },
  gridColumn: 0,
  gridRow: index * 3,
  colSpan: 4,
  rowSpan: 3,
}));

/** What a peer would lend: it prints what the header handed it. */
function LentProbe({ boardKind, boardId, boardName, widgetCount }: BoardHeaderActionProps) {
  return (
    <output aria-label="Lent action">
      {[boardKind, boardId, boardName, widgetCount ?? "loading"].join(" | ")}
    </output>
  );
}
const LENT: UiLend = {
  token: BoardHeaderActionToken,
  load: () => Promise.resolve({ default: LentProbe }),
};

function openScreen({
  element,
  params,
  lends,
}: {
  element: ReactElement;
  params: Record<string, string>;
  lends: readonly UiLend[];
}) {
  const host = new StubAnalyticsHost({
    flags: { release_dashboards: true },
    permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
    route: { params, query: {} },
  });
  const services = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    declarations: uiDeclarations([{ name: "insight", installation: { capabilities: {}, lends } }]),
  };
  renderDashboards({
    element: (
      <UiHostServicesContextProvider value={services}>{element}</UiHostServicesContextProvider>
    ),
    host,
    answer: (call: UiProcedureCall) => {
      if (call.path === "dashboards.getAll") return Promise.resolve([{ ...BOARD }]);
      if (call.path === "dashboards.listStarred") return Promise.resolve([]);
      if (call.path === "dashboardWidgets.list") return Promise.resolve(WIDGETS);
      return NO_PROCEDURES(call);
    },
  });
}

afterEach(cleanup);

describe("given a module lends an action to the board header", () => {
  describe("when a member opens a stored board with 2 widgets", () => {
    /** @scenario "A board's header draws the action a peer lends it" */
    it("hands it the kind dashboard, the board's id, its name and its widget count", async () => {
      openScreen({
        element: <DashboardBoardScreen />,
        params: { dashboardId: "board-1" },
        lends: [LENT],
      });

      expect(
        await screen.findByText("dashboard | board-1 | Weekly review | 2"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add a widget" })).toBeInTheDocument();
    });
  });

  describe("when a member opens a From LangWatch board", () => {
    /** @scenario "A board's header draws the action a peer lends it" */
    it("hands it the kind template, the template's id and its widget count", async () => {
      const board = curatedBoardById("release")!;
      openScreen({
        element: <CuratedBoardScreen />,
        params: { templateId: "release" },
        lends: [LENT],
      });

      expect(
        await screen.findByText(`template | release | ${board.name} | ${board.widgets.length}`),
      ).toBeInTheDocument();
    });
  });
});

describe("given no module lends an action to the board header", () => {
  describe("when a member opens a board", () => {
    /** @scenario "A board's header draws the action a peer lends it" */
    it("draws the header with nothing more", async () => {
      openScreen({
        element: <CuratedBoardScreen />,
        params: { templateId: "release" },
        lends: [],
      });

      expect(await screen.findByRole("heading", { name: "Release check" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Lent action")).toBeNull();
    });
  });
});
