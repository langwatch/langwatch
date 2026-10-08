/**
 * @vitest-environment jsdom
 * The ask bar on a board, against an in-memory server: typing opens the picker, and a
 * question asked there or from the bar reaches Langy with the board attached, writing nothing.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import DashboardBoardScreen from "../../ui/sections/dashboard-board.screen.tsx";

const BOARD = {
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};

/** One board with nothing on it, answered from memory; every call is kept. */
function inMemoryServer() {
  const state = { calls: [] as UiProcedureCall[] };
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    switch (call.path) {
      case "dashboards.listStarred":
        return Promise.resolve([]);
      case "dashboards.getAll":
        return Promise.resolve([{ ...BOARD }]);
      case "dashboardWidgets.list":
        return Promise.resolve([]);
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = ["analytics:view", "cost:view", "traces:view", "langy:create"];
/** The bar's own words, which name its field. */
const ASK_BAR = "What do you want to know?";
const WRITES = /^dashboards\.(?!getAll|listStarred|sourcePresence)|^dashboardWidgets\.(?!list)/;

function openBoard({
  server,
  query = {},
  flags = LANGY_ON,
  permissions = MEMBER,
}: {
  server: ReturnType<typeof inMemoryServer>;
  query?: Record<string, string>;
  flags?: Record<string, boolean>;
  permissions?: string[];
}) {
  const host = new StubAnalyticsHost({
    flags,
    permissions,
    route: { params: { dashboardId: BOARD.id }, query },
  });
  renderDashboards({ element: <DashboardBoardScreen />, host, answer: server.answer });
  return host;
}

const writesTo = (server: ReturnType<typeof inMemoryServer>) =>
  server.state.calls.filter(({ path }) => WRITES.test(path));

afterEach(cleanup);

describe("Langy on a board", () => {
  describe("given Langy is enabled for the project", () => {
    describe("when the member clicks the bar on their own board", () => {
      /** @scenario "Boards: the ask bar opens its modal on a click, with the cursor in the modal" */
      it("opens Add a widget, asks Langy nothing and holds no text itself", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer();
        const host = openBoard({ server });

        await user.click(await screen.findByRole("button", { name: ASK_BAR }));

        expect(host.lastQuery).toEqual({ addBlock: "open" });
        expect(host.langyAsks).toEqual([]);
        expect(screen.queryByRole("textbox", { name: ASK_BAR })).toBeNull();
        expect(writesTo(server)).toEqual([]);
      });
    });

    describe("when the member picks a suggested question on the empty board", () => {
      /** @scenario "Boards: every empty board shows one view" */
      it("asks Langy that question with the board attached", async () => {
        const user = userEvent.setup();
        const host = openBoard({ server: inMemoryServer() });

        await user.click(await screen.findByRole("button", { name: "What needs attention?" }));

        expect(host.langyAsks).toHaveLength(1);
        expect(host.langyAsks[0]?.question).toBe("What needs attention?");
        expect(host.langyAsks[0]?.context[0]).toMatchObject({ label: "Weekly review" });
      });
    });

    describe("when the member types their own question in the picker and asks it", () => {
      /** @scenario "AC16 Ask Langy from the board" */
      it("opens Langy with that question and the board attached", async () => {
        const user = userEvent.setup();
        const host = openBoard({ server: inMemoryServer(), query: { addBlock: "open" } });

        await user.type(await screen.findByRole("searchbox"), "Why did cost jump last week?");
        await user.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(host.lastQuery).toEqual({ addBlock: void 0 });
        expect(host.langyAsks).toHaveLength(1);
        const [ask] = host.langyAsks;
        expect(ask?.question).toBe("Why did cost jump last week?");
        expect(ask?.context).toHaveLength(1);
        expect(ask?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
        expect(ask?.context[0]?.ref).toContain('dashboard "Weekly review" (id board-1)');
        expect(ask?.context[0]?.ref).toContain("widgets: none yet");
      });
    });

    describe("when the member asks a typed question with Enter", () => {
      /** @scenario "AC16 Ask Langy from the board" */
      it("asks Langy with the board attached and changes nothing on it", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer();
        const host = openBoard({ server, query: { addBlock: "open" } });

        const search = await screen.findByRole("searchbox");
        await user.type(search, "What should I add to track cost?{Enter}");

        expect(host.langyAsks).toHaveLength(1);
        const [ask] = host.langyAsks;
        expect(ask?.question).toBe("What should I add to track cost?");
        expect(ask?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
        expect(writesTo(server)).toEqual([]);
      });
    });

    describe("when the picker's search is empty", () => {
      /** @scenario "AC16 Ask Langy from the board" */
      it("asks nothing on Enter, though the Ask Langy footer stays visible", async () => {
        const user = userEvent.setup();
        const host = openBoard({ server: inMemoryServer(), query: { addBlock: "open" } });

        await user.type(await screen.findByRole("searchbox"), "{Enter}");

        expect(screen.getByRole("button", { name: "Ask Langy" })).toBeInTheDocument();
        expect(host.langyAsks).toEqual([]);
      });
    });

    describe("when the member presses the footer's Ask Langy button with an empty field", () => {
      /** @scenario "AC16 Ask Langy from the board" */
      it("asks Langy to help build a dashboard", async () => {
        const user = userEvent.setup();
        const host = openBoard({ server: inMemoryServer(), query: { addBlock: "open" } });

        await screen.findByRole("searchbox");
        await user.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(host.langyAsks).toHaveLength(1);
        expect(host.langyAsks[0]?.question).toBe("Help me build a dashboard");
      });
    });
  });

  describe("given Langy is not enabled for the member", () => {
    /** @scenario "Boards: every board has the ask bar" */
    it.each([
      ["the release flag is off", { release_dashboards: true }, MEMBER],
      [
        "the member may not start a conversation",
        LANGY_ON,
        MEMBER.filter((permission) => permission !== "langy:create"),
      ],
    ])(
      "keeps the bar for finding a widget, with no suggested questions, when %s",
      async (_case, flags, permissions) => {
        openBoard({ server: inMemoryServer(), flags, permissions });

        expect(await screen.findByText("Or start from a template")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: ASK_BAR })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "What needs attention?" })).toBeNull();
      },
    );
  });
});
