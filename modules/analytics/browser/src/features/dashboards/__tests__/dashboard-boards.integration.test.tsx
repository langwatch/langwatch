/**
 * @vitest-environment jsdom
 * A member's own boards against an in-memory dashboards and widgets server:
 * the header, the blank board, the question picker, the period and the block
 * menu. @see modules/dashboard/specs/dashboards-v1.feature
 */

import {
  type UiProcedureCall,
  UiProcedureRefusal,
} from "@langwatch/browser-host/testing-transport";
import type { DashboardVisibility } from "@langwatch/dashboard-contract";
import { explainAnyError } from "@langwatch/error-presentation/presentation";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { findBlock } from "../blocks/index.ts";
import { TRACE_COUNT_SQL } from "../blocks/model/block-queries.ts";
import { BLOCK_QUESTION_SECTIONS } from "../model/block-questions.ts";
import { blockWidgetDefinition } from "../model/board-blocks.ts";
import { BOARD_VISIBILITY_LOCKED_REASON } from "../model/board-visibility.ts";
import { FLIGHT_DECK } from "../model/boards.ts";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

type Board = {
  id: string;
  name: string;
  description: string | null;
  visibility: DashboardVisibility;
  createdById: string | null;
};
type Widget = {
  id: string;
  dashboardId: string | null;
  name: string;
  graph: { version: 1; code: string; queries: { name: string; sql: string }[] };
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
};
type Input = Record<string, unknown>;

/** A widget as the store holds one library block. */
function storedBlock({
  id,
  dashboardId,
  blockId,
}: {
  id: string;
  dashboardId: string;
  blockId: string;
}): Widget {
  const block = findBlock(blockId)!;
  const { name, code, queries } = blockWidgetDefinition({ block });
  return {
    id,
    dashboardId,
    name,
    graph: { version: 1 as const, code, queries },
    gridColumn: 0,
    gridRow: 0,
    colSpan: 4,
    rowSpan: 4,
  };
}

/** The dashboards, widgets and LangWatchQL procedures, answered from memory across reloads. */
function inMemoryServer({
  boards,
  widgets = [],
  refuseVisibility = false,
}: {
  boards: Board[];
  widgets?: Widget[];
  /** Answers `setVisibility` as the server does for a member who is neither creator nor admin. */
  refuseVisibility?: boolean;
}) {
  const state = {
    boards: boards.map((board) => ({ ...board })),
    widgets: [...widgets],
    calls: [] as UiProcedureCall[],
  };
  let minted = 0;
  const find = (id: unknown) => state.widgets.find((widget) => widget.id === id)!;
  const board = (id: unknown) => state.boards.find((each) => each.id === id)!;

  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    const input = (call.input ?? {}) as Input;
    switch (call.path) {
      case "dashboards.getAll":
        return Promise.resolve(state.boards.map((board) => ({ ...board })));
      case "dashboards.rename": {
        const renamed = board(input.dashboardId);
        renamed.name = String(input.name);
        return Promise.resolve({ ...renamed });
      }
      case "dashboards.updateDetails": {
        const described = board(input.dashboardId);
        described.description = input.description as string | null;
        return Promise.resolve({ ...described });
      }
      case "dashboards.setVisibility": {
        if (refuseVisibility) {
          return Promise.reject(new UiProcedureRefusal("dashboard_owner_only", 403));
        }
        const shared = board(input.dashboardId);
        shared.visibility = input.visibility as DashboardVisibility;
        return Promise.resolve({ ...shared });
      }
      case "dashboards.sourcePresence":
        return Promise.resolve({
          traces: "present",
          scenarios: "absent",
          judges: "absent",
          feedback: "absent",
          gateway: "absent",
          codingAgents: "absent",
        });
      case "dashboardWidgets.list":
        return Promise.resolve(state.widgets.map((widget) => ({ ...widget })));
      case "dashboardWidgets.create": {
        minted += 1;
        const widget: Widget = {
          id: `widget-new-${minted}`,
          dashboardId: (input.dashboardId as string | undefined) ?? null,
          name: String(input.name),
          graph: {
            version: 1,
            code: String(input.code),
            queries: input.queries as Widget["graph"]["queries"],
          },
          gridColumn: 0,
          gridRow: 99,
          colSpan: 4,
          rowSpan: 3,
        };
        state.widgets.push(widget);
        return Promise.resolve({ ...widget, definition: widget.graph });
      }
      case "dashboardWidgets.updateLayout": {
        const { graphId, gridColumn, gridRow, colSpan, rowSpan } = input as Input & Widget;
        Object.assign(find(graphId), { gridColumn, gridRow, colSpan, rowSpan });
        return Promise.resolve({ success: true });
      }
      case "dashboardWidgets.assignDashboard":
        find(input.id).dashboardId = String(input.dashboardId);
        return Promise.resolve({ success: true });
      case "dashboardWidgets.delete":
        state.widgets = state.widgets.filter((widget) => widget.id !== input.id);
        return Promise.resolve({ success: true });
      case "analytics.lwql.query":
        return Promise.resolve({ columns: [], rows: lwqlRows(String(input.sql)), diagnostics: [] });
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

/** The trace count has one bucket; everything else is empty. */
function lwqlRows(sql: string): Record<string, unknown>[] {
  if (sql === TRACE_COUNT_SQL) return [{ bucket: "2026-09-01 00:00:00", traces: 7 }];
  return [];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FLAG_ON = { release_dashboards: true };
const OWN_BOARDS: Board[] = [
  {
    id: "board-1",
    name: "Weekly review",
    description: null,
    visibility: "only_me",
    createdById: "user-1",
  },
  {
    id: "board-2",
    name: "Latency",
    description: null,
    visibility: "only_me",
    createdById: "user-1",
  },
];

function openBoard({
  server,
  dashboardId = "board-1",
  query = {},
  withSidebar = false,
  userId = "user-1",
  permissions,
}: {
  server: ReturnType<typeof inMemoryServer>;
  dashboardId?: string;
  query?: Record<string, string>;
  withSidebar?: boolean;
  userId?: string;
  permissions?: string[];
}) {
  const host = new StubAnalyticsHost({
    flags: FLAG_ON,
    userId,
    permissions,
    route: { params: { dashboardId }, query },
  });
  const view = renderDashboards({
    element: (
      <>
        {withSidebar && <SavedDashboardsSection activeDashboardId={dashboardId} />}
        <DashboardBoardScreen />
      </>
    ),
    host,
    answer: server.answer,
  });
  return { host, view };
}

const callsTo = (server: ReturnType<typeof inMemoryServer>, path: string) =>
  server.state.calls.filter((call) => call.path === path);

afterEach(cleanup);

describe("a member's own board", () => {
  describe("given a member creates a new dashboard", () => {
    describe("when it opens", () => {
      /** @scenario "AC10 Blank board matches the reference" */
      it("shows the blank-board state with the template strip", async () => {
        openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

        expect(await screen.findByRole("button", { name: /Add a block/ })).toBeInTheDocument();
        expect(screen.getByText("Add a description")).toBeInTheDocument();
        expect(screen.getByText("Start from the question you need answered.")).toBeInTheDocument();
        expect(screen.getByText("Start from a template")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Agent Flight Deck/ })).toBeInTheDocument();
      });

      /** @scenario "AC10 Blank board matches the reference" */
      it("opens the picker from the Add a block area and the Flight Deck from the template", async () => {
        const user = userEvent.setup();
        const { host } = openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

        await user.click(await screen.findByRole("button", { name: /Add a block/ }));
        expect(host.lastQuery).toEqual({ addBlock: "open" });

        await user.click(screen.getByRole("button", { name: /Agent Flight Deck/ }));
        expect(host.navigations).toEqual([`/test-project/dashboards/${FLIGHT_DECK.id}`]);
      });
    });
  });

  describe("given the picker is open on the member's own board", () => {
    describe("when the member browses every section", () => {
      /** @scenario "AC12 Only working questions are offered" */
      it("lists exactly the questions that map to a library block, each as a button", async () => {
        openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }), query: { addBlock: "open" } });

        const dialog = await screen.findByRole("dialog");
        for (const section of BLOCK_QUESTION_SECTIONS) {
          const listed = within(within(dialog).getByRole("region", { name: section.title }));
          for (const { question } of section.questions) {
            expect(
              listed.getByRole("button", { name: new RegExp(escape(question)) }),
            ).toBeEnabled();
          }
        }
        const questionCount = BLOCK_QUESTION_SECTIONS.flatMap(({ questions }) => questions).length;
        const rows = BLOCK_QUESTION_SECTIONS.flatMap(({ title }) =>
          within(within(dialog).getByRole("region", { name: title })).getAllByRole("button"),
        );
        expect(rows).toHaveLength(questionCount);
      });
    });

    describe("when they choose a question", () => {
      /** @scenario "AC11 Add a block by question" */
      it("adds that one block to the board, where it renders the block's real data", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer({ boards: OWN_BOARDS });
        const { host } = openBoard({ server, query: { addBlock: "open" } });

        await user.click(
          await screen.findByRole("button", { name: /How much traffic did my agent handle\?/ }),
        );

        await waitFor(() => expect(host.lastQuery).toEqual({ addBlock: void 0 }));
        const creates = callsTo(server, "dashboardWidgets.create");
        expect(creates).toHaveLength(1);
        expect(creates[0]?.input).toMatchObject({
          projectId: "proj-1",
          dashboardId: "board-1",
          name: "Trace count over time",
          queries: [{ name: "main", sql: TRACE_COUNT_SQL }],
        });
        const block = await screen.findByTestId("dashboard-block-trace-count-over-time");
        await waitFor(() =>
          expect(
            callsTo(server, "analytics.lwql.query").some(
              (call) => (call.input as Input).sql === TRACE_COUNT_SQL,
            ),
          ).toBe(true),
        );
        await waitFor(() => expect(within(block).queryByText("Loading")).toBeNull());
        expect(within(block).queryByText("No data yet")).toBeNull();
        expect(screen.getAllByTestId(/^dashboard-block-/)).toHaveLength(1);
      });
    });
  });

  describe("given a board with time-series blocks", () => {
    const boardWithTwoBlocks = () =>
      inMemoryServer({
        boards: OWN_BOARDS,
        widgets: [
          storedBlock({ id: "w-1", dashboardId: "board-1", blockId: "trace-count-over-time" }),
          storedBlock({ id: "w-2", dashboardId: "board-1", blockId: "total-cost-over-time" }),
        ],
      });

    /** The period each block's data statement was asked for, by statement. */
    const periodsAsked = async (server: ReturnType<typeof inMemoryServer>) => {
      await waitFor(() =>
        expect(callsTo(server, "analytics.lwql.query").filter(hasWindow)).toHaveLength(2),
      );
      return callsTo(server, "analytics.lwql.query")
        .filter(hasWindow)
        .map((call) => {
          const { timeWindow, granularitySeconds } = call.input as Input & {
            timeWindow: { start: string; end: string };
          };
          const spanMs = Date.parse(timeWindow.end) - Date.parse(timeWindow.start);
          return { spanMs, granularitySeconds };
        });
    };
    const hasWindow = (call: UiProcedureCall) => (call.input as Input).timeWindow !== void 0;

    describe("when the member changes the period", () => {
      /** @scenario "AC13 Period and grain update every block" */
      it("reads every block over the chosen period", async () => {
        const dayServer = boardWithTwoBlocks();
        openBoard({ server: dayServer, query: { range: "24h" } });
        const day = await periodsAsked(dayServer);
        cleanup();

        const weekServer = boardWithTwoBlocks();
        openBoard({ server: weekServer, query: { range: "7d" } });
        const week = await periodsAsked(weekServer);

        expect(day.map(({ spanMs }) => spanMs)).toEqual([86_400_000, 86_400_000]);
        expect(week.map(({ spanMs }) => spanMs)).toEqual([604_800_000, 604_800_000]);
      });

      /** @scenario "AC13 Period and grain update every block" */
      it("writes the chosen range to the address the whole board reads", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host } = openBoard({ server: boardWithTwoBlocks() });

        await user.click(await screen.findByRole("button", { name: "Period" }));
        await user.click(await screen.findByRole("menuitem", { name: /^7d/ }));

        expect(host.lastQuery).toEqual({ range: "7d" });
      });
    });

    describe("when the member changes the grain", () => {
      /** @scenario "AC13 Grain choices update every block" */
      it.each([
        ["1h", "24h", 3600],
        ["1d", "30d", 86_400],
        ["1w", "90d", 604_800],
      ])("reads every block at %s buckets", async (grain, range, seconds) => {
        const server = boardWithTwoBlocks();
        openBoard({ server, query: { range, grain } });

        const asked = await periodsAsked(server);
        expect(asked.map(({ granularitySeconds }) => granularitySeconds)).toEqual([
          seconds,
          seconds,
        ]);
      });

      /** @scenario "AC13 Grain choices update every block" */
      it("offers auto, 1h, 1d and 1w, none of them held back", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host } = openBoard({ server: boardWithTwoBlocks() });

        await user.click(await screen.findByRole("button", { name: "Period" }));
        const grains = within(await screen.findByRole("group", { name: "Grain" }));
        for (const grain of ["auto", "1h", "1d", "1w"]) {
          expect(
            grains.getByRole("menuitem", { name: new RegExp(`^${grain}`) }),
          ).not.toHaveAttribute("aria-disabled", "true");
        }
        await user.click(grains.getByRole("menuitem", { name: /^1w/ }));

        expect(host.lastQuery).toEqual({ grain: "1w" });
      });
    });
  });

  describe("given a member on their own board", () => {
    describe("when they rename it inline", () => {
      /** @scenario "AC14 Rename and describe" */
      it("saves the name and shows it on the board and in the sidebar", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer({ boards: OWN_BOARDS });
        openBoard({ server, withSidebar: true });

        await user.click(await screen.findByRole("button", { name: "Rename dashboard" }));
        const field = screen.getByRole("textbox", { name: "Dashboard name" });
        await user.clear(field);
        await user.type(field, "Launch week{Enter}");

        expect(callsTo(server, "dashboards.rename")[0]?.input).toEqual({
          projectId: "proj-1",
          dashboardId: "board-1",
          name: "Launch week",
        });
        expect(await screen.findByRole("heading", { name: "Launch week" })).toBeInTheDocument();
        expect(
          within(screen.getByRole("list", { name: "Mine" })).getByRole("link", {
            name: /Launch week/,
          }),
        ).toBeInTheDocument();
      });
    });

    describe("when they describe it inline", () => {
      /** @scenario "AC14 Rename and describe" */
      it("saves the description, shows it in place of the prompt, and keeps it after reload", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer({ boards: OWN_BOARDS });
        openBoard({ server });

        await user.click(await screen.findByText("Add a description"));
        await user.type(
          screen.getByRole("textbox", { name: "Dashboard description" }),
          "What we check every Monday{Enter}",
        );

        expect(screen.getByText("What we check every Monday")).toBeInTheDocument();
        expect(screen.queryByText("Add a description")).toBeNull();
        await waitFor(() =>
          expect(callsTo(server, "dashboards.updateDetails")[0]?.input).toEqual({
            projectId: "proj-1",
            dashboardId: "board-1",
            description: "What we check every Monday",
          }),
        );

        cleanup();
        openBoard({ server });
        expect(await screen.findByText("What we check every Monday")).toBeInTheDocument();
      });
    });
  });

  describe("given a member on a board they created", () => {
    const chooseVisibility = async ({ from, to }: { from: string; to: RegExp }) => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await user.click(await screen.findByRole("button", { name: `Visibility: ${from}` }));
      await user.click(await screen.findByRole("menuitem", { name: to }));
    };

    describe("when they share it with their team", () => {
      /** @scenario "AC18 Visibility hides a board from members outside its audience" */
      it("saves the visibility and lists the board under Team in the sidebar", async () => {
        const server = inMemoryServer({ boards: OWN_BOARDS });
        openBoard({ server, withSidebar: true });

        await chooseVisibility({ from: "Only me", to: /^Team/ });

        expect(callsTo(server, "dashboards.setVisibility")[0]?.input).toEqual({
          projectId: "proj-1",
          dashboardId: "board-1",
          visibility: "team",
        });
        expect(await screen.findByRole("button", { name: "Visibility: Team" })).toBeEnabled();
        const team = await screen.findByRole("list", { name: "Team" });
        expect(within(team).getByRole("link", { name: /Weekly review/ })).toBeInTheDocument();
        expect(
          within(screen.getByRole("list", { name: "Mine" })).queryByRole("link", {
            name: /Weekly review/,
          }),
        ).toBeNull();
      });
    });

    describe("when the server refuses the change", () => {
      /** @scenario "AC26 Only the creator or an admin can change visibility or delete the board" */
      it("says why beside the control, in the words for the refusal's code", async () => {
        const server = inMemoryServer({ boards: OWN_BOARDS, refuseVisibility: true });
        openBoard({ server });

        await chooseVisibility({ from: "Only me", to: /^Organisation/ });

        const expected = explainAnyError({
          data: { error: { code: "dashboard_owner_only", httpStatus: 403, meta: {} } },
        });
        expect(await screen.findByRole("alert")).toHaveTextContent(expected.title);
        expect(screen.getByRole("button", { name: "Visibility: Only me" })).toBeInTheDocument();
      });
    });
  });

  describe("given a shared board someone else created", () => {
    const sharedBoard = (): Board[] => [
      { ...OWN_BOARDS[0]!, visibility: "organisation", createdById: "user-2" },
    ];

    /** @scenario "AC26 Only the creator or an admin can change visibility or delete the board" */
    it("shows the control disabled, with the reason, to a member who is not an admin", async () => {
      openBoard({ server: inMemoryServer({ boards: sharedBoard() }) });

      const control = await screen.findByRole("button", { name: "Visibility: Organisation" });
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute("title", BOARD_VISIBILITY_LOCKED_REASON);
    });

    /** @scenario "AC26 Only the creator or an admin can change visibility or delete the board" */
    it("lets an admin change it", async () => {
      openBoard({
        server: inMemoryServer({ boards: sharedBoard() }),
        permissions: ["analytics:view", "project:manage"],
      });

      expect(await screen.findByRole("button", { name: "Visibility: Organisation" })).toBeEnabled();
    });
  });

  describe("given a block on a user board", () => {
    const boardWithOneBlock = () =>
      inMemoryServer({
        boards: OWN_BOARDS,
        widgets: [
          storedBlock({ id: "w-1", dashboardId: "board-1", blockId: "trace-count-over-time" }),
        ],
      });

    const chooseFromBlockMenu = async ({ name }: { name: RegExp }) => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await user.click(
        await screen.findByRole("button", { name: "Actions for Trace count over time" }),
      );
      await user.click(await screen.findByRole("menuitem", { name }));
    };

    /** Unmounts everything, then opens the board again on fresh caches. */
    const reload = ({
      server,
      dashboardId,
    }: {
      server: ReturnType<typeof inMemoryServer>;
      dashboardId: string;
    }) => {
      cleanup();
      openBoard({ server, dashboardId });
    };

    describe("when the member duplicates it", () => {
      /** @scenario "AC15 Block menu actions persist after reload" */
      it("shows both copies after reload", async () => {
        const server = boardWithOneBlock();
        openBoard({ server });

        await chooseFromBlockMenu({ name: /Duplicate/ });
        await waitFor(() =>
          expect(callsTo(server, "dashboardWidgets.updateLayout")).toHaveLength(1),
        );
        reload({ server, dashboardId: "board-1" });

        await waitFor(() =>
          expect(screen.getAllByTestId("dashboard-block-trace-count-over-time")).toHaveLength(2),
        );
      });
    });

    describe("when the member moves it to another dashboard", () => {
      /** @scenario "AC15 Block menu actions persist after reload" */
      it("shows it on the other board and not on this one after reload", async () => {
        const server = boardWithOneBlock();
        openBoard({ server });

        await chooseFromBlockMenu({ name: /Latency/ });
        await waitFor(() =>
          expect(callsTo(server, "dashboardWidgets.updateLayout")).toHaveLength(1),
        );
        reload({ server, dashboardId: "board-1" });
        expect(await screen.findByRole("button", { name: /Add a block/ })).toBeInTheDocument();
        expect(screen.queryByTestId("dashboard-block-trace-count-over-time")).toBeNull();

        reload({ server, dashboardId: "board-2" });
        expect(
          await screen.findByTestId("dashboard-block-trace-count-over-time"),
        ).toBeInTheDocument();
      });
    });

    describe("when the member deletes it", () => {
      /** @scenario "AC15 Block menu actions persist after reload" */
      it("shows the blank board after reload", async () => {
        const server = boardWithOneBlock();
        openBoard({ server });

        await chooseFromBlockMenu({ name: /Delete/ });
        await waitFor(() => expect(callsTo(server, "dashboardWidgets.delete")).toHaveLength(1));
        reload({ server, dashboardId: "board-1" });

        expect(await screen.findByRole("button", { name: /Add a block/ })).toBeInTheDocument();
        expect(screen.queryByTestId("dashboard-block-trace-count-over-time")).toBeNull();
      });
    });
  });
});

describe("the Agent Flight Deck", () => {
  const openFlightDeck = ({
    server,
    query = {},
  }: {
    server: ReturnType<typeof inMemoryServer>;
    query?: Record<string, string>;
  }) => openBoard({ server, dashboardId: FLIGHT_DECK.id, query });

  describe("given any member views it", () => {
    /** @scenario "AC8 No edit controls appear on the Flight Deck" */
    it("offers no rename control and no block menu", async () => {
      openFlightDeck({ server: inMemoryServer({ boards: OWN_BOARDS }) });

      expect(await screen.findByRole("heading", { name: FLIGHT_DECK.name })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Rename dashboard" })).toBeNull();
      expect(screen.queryByText("Add a description")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Visibility/ })).toBeNull();
    });
  });

  describe("when the member adds a chart from it", () => {
    /** @scenario "AC11 Add a block by question" */
    it("adds the block to the chosen board of their own, never to the Flight Deck", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const { host } = openFlightDeck({ server, query: { addBlock: "open" } });

      await screen.findByRole("option", { name: "Latency" });
      await user.selectOptions(screen.getByRole("combobox", { name: "Add to" }), "board-2");
      await user.click(screen.getByRole("button", { name: /What are my agents spending\?/ }));

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-2"]));
      const creates = callsTo(server, "dashboardWidgets.create");
      expect(creates).toHaveLength(1);
      expect(creates[0]?.input).toMatchObject({
        dashboardId: "board-2",
        name: "Total cost over time",
      });
      expect(host.successes).toEqual([{ title: "Added to Latency" }]);
    });

    it("writes the picker's address when Add chart is pressed", async () => {
      const user = userEvent.setup();
      const { host } = openFlightDeck({ server: inMemoryServer({ boards: OWN_BOARDS }) });

      await user.click(await screen.findByRole("button", { name: /Add chart/ }));

      expect(host.lastQuery).toEqual({ addBlock: "open" });
    });
  });
});
