/**
 * @vitest-environment jsdom
 * Langy on a board, against an in-memory dashboards and widgets server: the
 * ask bar hands the question and the board to Langy, and a block just added
 * earns an insights offer that asks nothing until it is accepted.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import type { UiProcedureCall } from "@langwatch/browser-host/testing-transport";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import { findBlock } from "../../blocks/index.ts";
import { TRACE_COUNT_SQL } from "../../blocks/model/block-queries.ts";
import { blockWidgetDefinition } from "../../model/board-blocks.ts";
import { FLIGHT_DECK } from "../../model/boards.ts";
import DashboardBoardScreen from "../../ui/sections/dashboard-board.screen.tsx";

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

const BOARD = {
  id: "board-1",
  name: "Weekly review",
  description: null,
  visibility: "only_me",
  createdById: "user-1",
};

/** The trace-count block as the widget store holds it. */
function storedTraceCount(id: string): Widget {
  const { name, code, queries } = blockWidgetDefinition({
    block: findBlock("trace-count-over-time")!,
  });
  return {
    id,
    dashboardId: BOARD.id,
    name,
    graph: { version: 1, code, queries },
    gridColumn: 0,
    gridRow: 0,
    colSpan: 6,
    rowSpan: 3,
  };
}

/** One board, its widgets and the LangWatchQL they run, answered from memory. */
function inMemoryServer({ widgets = [] }: { widgets?: Widget[] } = {}) {
  const state = { widgets: [...widgets], calls: [] as UiProcedureCall[] };
  let minted = 0;
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    const input = (call.input ?? {}) as Input;
    switch (call.path) {
      case "dashboards.getAll":
        return Promise.resolve([{ ...BOARD }]);
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
          colSpan: 6,
          rowSpan: 3,
        };
        state.widgets.push(widget);
        return Promise.resolve({ ...widget, definition: widget.graph });
      }
      case "dashboardWidgets.updateLayout":
        return Promise.resolve({ success: true });
      case "analytics.lwql.query": {
        const rows =
          input.sql === TRACE_COUNT_SQL ? [{ bucket: "2026-09-01 00:00:00", traces: 7 }] : [];
        return Promise.resolve({ columns: [], rows, diagnostics: [] });
      }
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = ["analytics:view", "cost:view", "traces:view", "langy:create"];
const WRITES = /^dashboards\.(?!getAll|sourcePresence)|^dashboardWidgets\.(?!list)/;

function openBoard({
  server,
  dashboardId = BOARD.id,
  query = {},
  flags = LANGY_ON,
  permissions = MEMBER,
}: {
  server: ReturnType<typeof inMemoryServer>;
  dashboardId?: string;
  query?: Record<string, string>;
  flags?: Record<string, boolean>;
  permissions?: string[];
}) {
  const host = new StubAnalyticsHost({
    flags,
    permissions,
    route: { params: { dashboardId }, query },
  });
  renderDashboards({ element: <DashboardBoardScreen />, host, answer: server.answer });
  return host;
}

const writesTo = (server: ReturnType<typeof inMemoryServer>) =>
  server.state.calls.filter(({ path }) => WRITES.test(path));

afterEach(cleanup);

describe("Langy on a board", () => {
  describe("given Langy is enabled for the project", () => {
    describe("when the member types a question on their own board and presses Ask", () => {
      /** @scenario "AC16 Ask Langy from the board" */
      it("opens Langy with that question and the board attached", async () => {
        const user = userEvent.setup();
        const host = openBoard({ server: inMemoryServer() });

        const field = await screen.findByRole("textbox", {
          name: "Ask Langy about this dashboard",
        });
        expect(field).toHaveAttribute("placeholder", "What would you like to know?");
        await user.type(field, "Why did cost jump last week?");
        await user.click(screen.getByRole("button", { name: "Ask" }));

        expect(host.langyAsks).toHaveLength(1);
        const [ask] = host.langyAsks;
        expect(ask?.question).toBe("Why did cost jump last week?");
        expect(ask?.context).toHaveLength(1);
        expect(ask?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
        expect(ask?.context[0]?.ref).toContain('dashboard "Weekly review" (id board-1)');
        expect(ask?.context[0]?.ref).toContain("the member's own dashboard");
        expect(field).toHaveValue("");
      });
    });

    describe("when the member asks from the Agent Flight Deck", () => {
      /** @scenario "AC16 Ask Langy from the board" */
      it("attaches the deck as read-only and changes nothing on it", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer();
        const host = openBoard({ server, dashboardId: FLIGHT_DECK.id });

        const field = await screen.findByRole("textbox", {
          name: "Ask Langy about this dashboard",
        });
        await user.type(field, "What should I add to track cost?{Enter}");

        expect(host.langyAsks).toHaveLength(1);
        const [ask] = host.langyAsks;
        expect(ask?.question).toBe("What should I add to track cost?");
        expect(ask?.context[0]).toMatchObject({ kind: "dashboard", label: FLIGHT_DECK.name });
        expect(ask?.context[0]?.ref).toContain("read-only");
        expect(ask?.context[0]?.ref).toContain("Status");
        expect(writesTo(server)).toEqual([]);
      });
    });

    describe("when the member presses Ask with nothing typed", () => {
      /** @scenario "AC16 Ask Langy from the board" */
      it("asks nothing", async () => {
        const user = userEvent.setup();
        const host = openBoard({ server: inMemoryServer() });

        await screen.findByRole("textbox", { name: "Ask Langy about this dashboard" });
        await user.click(screen.getByRole("button", { name: "Ask" }));

        expect(host.langyAsks).toEqual([]);
      });
    });
  });

  describe("given Langy is not enabled for the member", () => {
    /** @scenario "AC16 Ask Langy from the board" */
    it.each([
      ["the release flag is off", { release_dashboards: true }, MEMBER],
      [
        "the member may not start a conversation",
        LANGY_ON,
        MEMBER.filter((permission) => permission !== "langy:create"),
      ],
    ])("shows no ask bar when %s", async (_case, flags, permissions) => {
      openBoard({ server: inMemoryServer(), flags, permissions });

      expect(await screen.findByRole("button", { name: /Add a block/ })).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Ask Langy about this dashboard" })).toBeNull();
      expect(screen.queryByText("What would you like to know?")).toBeNull();
    });
  });

  describe("given a block was just added and its query returned a number", () => {
    /** Adds the trace-count block through the picker's Blocks and waits for the offer. */
    const addTraceCount = async () => {
      // The picker stays open under a static test address, so its backdrop is ignored.
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = inMemoryServer();
      const host = openBoard({ server, query: { addBlock: "open" } });
      await user.click(await screen.findByRole("button", { name: /Trace count over time/ }));
      const accept = await screen.findByRole("button", { name: "Generate insights", hidden: true });
      await waitFor(() => expect(accept).toBeEnabled());
      return { user, server, host, accept };
    };

    describe("when the member accepts Generate insights", () => {
      /** @scenario "AC17 Langy insights on a block quote the block's own result" */
      it("asks Langy about that block with the numbers its own query returned", async () => {
        const { user, server, host, accept } = await addTraceCount();
        const writesBefore = writesTo(server).length;
        expect(host.langyAsks).toEqual([]);

        await user.click(accept);

        expect(host.langyAsks).toHaveLength(1);
        const [ask] = host.langyAsks;
        expect(ask?.question).toMatch(/^Generate insights on "Trace count over time"/);
        expect(ask?.question).toContain("Quote the numbers from its result");
        expect(ask?.context[0]).toMatchObject({
          kind: "dashboard",
          label: "Trace count over time",
        });
        expect(ask?.context[0]?.ref).toContain("main: bucket=2026-09-01 00:00:00, traces=7");
        expect(writesTo(server)).toHaveLength(writesBefore);
        expect(
          screen.queryByRole("button", { name: "Generate insights", hidden: true }),
        ).toBeNull();
      });
    });

    describe("when the member turns the offer down", () => {
      /** @scenario "AC17 Langy insights on a block quote the block's own result" */
      it("retires the offer and asks nothing", async () => {
        const { user, host } = await addTraceCount();

        await user.click(screen.getByRole("button", { name: "Not now", hidden: true }));

        expect(
          screen.queryByRole("button", { name: "Generate insights", hidden: true }),
        ).toBeNull();
        expect(host.langyAsks).toEqual([]);
      });
    });
  });

  describe("given a board whose blocks were there before it opened", () => {
    /** @scenario "AC17 Langy insights on a block quote the block's own result" */
    it("offers no insights, since no block was just added", async () => {
      openBoard({ server: inMemoryServer({ widgets: [storedTraceCount("w-1")] }) });

      await screen.findByTestId("dashboard-block-trace-count-over-time");
      await screen.findByRole("textbox", { name: "Ask Langy about this dashboard" });
      expect(screen.queryByRole("button", { name: "Generate insights", hidden: true })).toBeNull();
    });
  });
});
