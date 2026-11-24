/**
 * @vitest-environment jsdom
 * Asking Langy from inside a widget card, against an in-memory board: the spelled-out Ask
 * Langy button, a click on the chart and the action buttons a catalogue widget declares each
 * hand Langy a draft about that widget; without Langy none of them is offered.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { ChartAskSubject } from "@langwatch/analytics-contract/chart-frame-protocol";
import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { frameProps } = vi.hoisted(() => ({
  frameProps: vi.fn<(props: SandboxedChartFrameProps) => void>(),
}));

vi.mock("../../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: SandboxedChartFrameProps) => {
    frameProps(props);
    return <div data-testid="sandboxed-frame" />;
  },
}));

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import {
  HOME_BOARD,
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { BoardWidgetCard } from "../../ui/sections/board-widget-card.tsx";
import DashboardBoardScreen from "../../ui/sections/dashboard-board.screen.tsx";
import { UnsavedBoardProvider, useLangyAsk } from "../behavior/use-board-langy.ts";
import { boardSubject, widgetActionDraft } from "../model/board-langy.ts";

const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
const SQL = "SELECT count() FROM trace_metrics_by_minute";
const graph = (source?: { kind: "catalogue"; catalogueId: string }) => ({
  version: 1 as const,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "series", sql: SQL }],
  ...(source ? { source } : {}),
});
const FAILURES = {
  id: "w-1",
  dashboardId: BOARD.id,
  name: "Top errors",
  graph: graph({ kind: "catalogue", catalogueId: "fd-failures" }),
  gridColumn: 0,
  gridRow: 0,
  colSpan: 6,
  rowSpan: 6,
};
const HAND_WRITTEN = { ...FAILURES, id: "w-2", name: "My chart", gridRow: 6, graph: graph() };

function inMemoryServer() {
  return {
    answer: (call: UiProcedureCall): Promise<unknown> => {
      switch (call.path) {
        case "boards.listStarred":
          return Promise.resolve([]);
        case "boards.getAll":
          return Promise.resolve([{ ...BOARD }]);
        case "dashboardWidgets.list":
          return Promise.resolve([{ ...FAILURES }, { ...HAND_WRITTEN }]);
        default:
          return NO_PROCEDURES(call);
      }
    },
  };
}

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = [...ANALYTICS_MEMBER_PERMISSIONS];
const LANGY_MEMBER = [...MEMBER, "langy:create"];

function openBoard({ permissions = LANGY_MEMBER }: { permissions?: string[] } = {}) {
  const host = new StubAnalyticsHost({
    flags: LANGY_ON,
    permissions,
    route: { params: { dashboardId: BOARD.id }, query: {} },
  });
  renderDashboards({ element: <DashboardBoardScreen />, host, answer: inMemoryServer().answer });
  return host;
}

/** The frame props of the named widget's chart, as last rendered. */
function frameOf(widgetName: string): SandboxedChartFrameProps {
  const props = frameProps.mock.calls
    .map(([each]) => each)
    .findLast((each) => each.dashboardContext.widgetName === widgetName);
  if (!props) throw new Error(`no frame for ${widgetName}`);
  return props;
}

/** The chart's code calls `LW.askLangy(subject)`, as a clicked mark does. */
async function chartAsks({
  widgetName,
  subject,
}: {
  widgetName: string;
  subject: ChartAskSubject;
}) {
  const { onAskLangy } = frameOf(widgetName);
  if (!onAskLangy) throw new Error(`${widgetName} takes no asks`);
  await act(async () => onAskLangy(subject));
}

beforeEach(() => frameProps.mockClear());
afterEach(cleanup);

describe("asking Langy from a widget card", () => {
  describe("given Langy is on and the member may start a conversation", () => {
    /** @scenario "AC120 Ask Langy: each widget card offers Ask Langy only when Langy is available" */
    it("spells out Ask Langy, outside the controls that show only on hover", async () => {
      openBoard();

      const ask = await screen.findByRole(
        "button",
        { name: "Ask Langy about Top errors" },
        { timeout: 5_000 },
      );
      const menu = screen.getByRole("button", { name: "Actions for Top errors" });
      expect(ask).toHaveTextContent("Ask Langy");
      expect(menu.parentElement?.contains(ask)).toBe(false);
    });

    describe("when the chart reports a clicked bar at one bucket", () => {
      /** @scenario "AC124 Chart asks: clicking a bar or a point drafts Langy about that category and the period" */
      it("drafts an investigation of that series at that bucket, with the widget and the board", async () => {
        const host = openBoard();
        await screen.findByRole("button", { name: "Ask Langy about Top errors" });

        expect(frameOf("Top errors").dashboardContext.canAskLangy).toBe(true);
        await chartAsks({ widgetName: "Top errors", subject: { label: "Errors", at: "Sep 3" } });

        expect(host.langyAsks).toHaveLength(1);
        const [request] = host.langyAsks;
        expect(request?.question).toBeUndefined();
        expect(
          request?.draft?.startsWith(
            'Investigate "Errors" at Sep 3 in my "Top errors" dashboard widget.',
          ),
        ).toBe(true);
        expect(request?.draft).toContain(`- series:\n${SQL}`);
        expect(request?.draft).toContain("Dashboard period:");
        expect(request?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
      });
    });

    describe("when the widget's catalogue widget declares actions", () => {
      /** @scenario "AC125 Widget actions: a problem widget offers its declared actions under the chart" */
      it("shows Investigate and Propose a fix under the chart", async () => {
        openBoard();

        const row = await screen.findByRole("group", { name: "Langy actions for Top errors" });
        expect(
          within(row)
            .getAllByRole("button")
            .map((button) => button.textContent),
        ).toEqual(["Investigate", "Propose a fix"]);
      });

      /** @scenario "AC125b Widget actions: each action drafts its own prompt about the widget" */
      it("drafts the action's own prompt about the widget when one is clicked", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const host = openBoard();

        const row = await screen.findByRole("group", { name: "Langy actions for Top errors" });
        await user.click(within(row).getByRole("button", { name: "Propose a fix" }));

        expect(host.langyAsks).toHaveLength(1);
        const [request] = host.langyAsks;
        expect(request?.question).toBeUndefined();
        expect(
          request?.draft?.startsWith(
            'Propose a fix for the worst problem my "Top errors" dashboard widget shows',
          ),
        ).toBe(true);
        expect(request?.draft).toContain("change nothing until I agree");
        expect(request?.draft).toContain(`- series:\n${SQL}`);
      });
    });

    describe("when a widget declares no actions", () => {
      /** @scenario "AC125c Widget actions: a widget that declares no actions shows no action row" */
      it("shows no action row on it", async () => {
        openBoard();

        await screen.findByRole("button", { name: "Ask Langy about My chart" });
        expect(screen.queryByRole("group", { name: "Langy actions for My chart" })).toBeNull();
      });
    });
  });

  describe("given the member may not start a Langy conversation", () => {
    /**
     * @scenario "AC124c Chart asks: a chart with nothing to investigate offers no click"
     * @scenario "AC125c Widget actions: a widget that declares no actions shows no action row"
     */
    it("offers no chart asks and no action row", async () => {
      openBoard({ permissions: MEMBER });

      await screen.findByRole("button", { name: "Actions for Top errors" });
      expect(frameOf("Top errors").onAskLangy).toBeUndefined();
      expect(frameOf("Top errors").dashboardContext.canAskLangy).toBe(false);
      expect(screen.queryByRole("group", { name: "Langy actions for Top errors" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Ask Langy about Top errors" })).toBeNull();
    });
  });
});

const PERIOD = { periodStart: 1_000, periodEnd: 2_000, granularitySeconds: 3_600 as const };
const UNSAVED_WIDGET: BoardWidget = {
  id: "w-1",
  name: "Top errors",
  definition: graph({ kind: "catalogue", catalogueId: "fd-failures" }),
  placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 6, rowSpan: 6 },
};

/** A card on a new board, asking Langy as the board screen does. */
function UnsavedCard() {
  const langy = useLangyAsk();
  const board = boardSubject({
    board: { id: "new", name: "Untitled" },
    widgets: [UNSAVED_WIDGET],
  });
  const ask = () => undefined;
  return (
    <BoardWidgetCard
      widget={UNSAVED_WIDGET}
      projectId="proj-1"
      projectSlug="checkout"
      dashboardId="new"
      boardName="Untitled"
      period={PERIOD}
      periodKey="30d:auto"
      isWriting={false}
      langy={{
        ask,
        setUp: ask,
        setUpMissing: ask,
        askAbout: ask,
        act: (action) =>
          langy.ask(widgetActionDraft({ action, widget: UNSAVED_WIDGET, board, period: PERIOD })),
      }}
    />
  );
}

describe("given a new board that is not stored yet", () => {
  /** @scenario "AC126 Widget asks on a new board store the board first" */
  it("stores the board before an action's draft reaches Langy, which names the stored board", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const host = new StubAnalyticsHost({ flags: LANGY_ON, permissions: LANGY_MEMBER });
    const storedBoardId = vi.fn(() => Promise.resolve("board-9"));
    renderDashboards({
      element: (
        <UnsavedBoardProvider value={{ draftId: "new", storedBoardId }}>
          <UnsavedCard />
        </UnsavedBoardProvider>
      ),
      host,
      answer: NO_PROCEDURES,
    });

    const row = await screen.findByRole("group", { name: "Langy actions for Top errors" });
    await user.click(within(row).getByRole("button", { name: "Investigate" }));

    await vi.waitFor(() => expect(host.langyAsks).toHaveLength(1));
    expect(storedBoardId).toHaveBeenCalledOnce();
    const [request] = host.langyAsks;
    expect(request?.about).toEqual({ ref: "board-9" });
    expect(request?.context[0]?.ref).toContain("(id board-9)");
  });
});
