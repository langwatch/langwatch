/**
 * @vitest-environment jsdom
 * A member's boards against an in-memory dashboards and widgets server: the
 * header, the blank board and its template, the picker (questions for Langy),
 * the period and the widget menu. @see modules/dashboard/specs/dashboards-v1.feature
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
import { PICKER_SECTIONS } from "../catalogue/index.ts";
import { BOARD_VISIBILITY_LOCKED_REASON } from "../model/board-visibility.ts";
import { BOARD_TEMPLATES } from "../templates/index.ts";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import {
  NO_PROCEDURES,
  recordWidgetFrames,
  renderDashboards,
} from "./render-dashboards.test-helpers.tsx";

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

const WIDGET_CODE = "export default function Widget() { return null; }";

/** An ordinary stored widget, as the create drawer or a template leaves one. */
function storedWidget({
  id,
  dashboardId,
  name,
  gridRow = 0,
}: {
  id: string;
  dashboardId: string;
  name: string;
  gridRow?: number;
}): Widget {
  return {
    id,
    dashboardId,
    name,
    graph: { version: 1, code: WIDGET_CODE, queries: [{ name: "main", sql: "SELECT 1" }] },
    gridColumn: 0,
    gridRow,
    colSpan: 4,
    rowSpan: 3,
  };
}

/** The dashboards and widgets procedures, answered from memory across reloads. */
function inMemoryServer({
  boards,
  widgets = [],
  refuseVisibility = false,
  refuseWidgetCreate = false,
}: {
  boards: Board[];
  widgets?: Widget[];
  /** Answers `setVisibility` as the server does for a member who is neither creator nor admin. */
  refuseVisibility?: boolean;
  /** Answers `dashboardWidgets.create` as the server does when the write is rejected. */
  refuseWidgetCreate?: boolean;
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
        return Promise.resolve(state.boards.map((each) => ({ ...each })));
      case "dashboards.create": {
        const created: Board = {
          id: `board-new-${state.boards.length + 1}`,
          name: String(input.name),
          description: null,
          visibility: input.visibility as DashboardVisibility,
          createdById: "user-1",
        };
        state.boards.push(created);
        return Promise.resolve({ ...created });
      }
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
      case "dashboardWidgets.list":
        return Promise.resolve(state.widgets.map((widget) => ({ ...widget })));
      case "dashboardWidgets.create": {
        if (refuseWidgetCreate) {
          return Promise.reject(new UiProcedureRefusal("dashboard_widget_definition_invalid", 422));
        }
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
          gridRow: 0,
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
      case "dashboardWidgets.batchUpdateLayouts": {
        for (const { graphId, ...placement } of input.layouts as (Input & { graphId: string })[]) {
          Object.assign(find(graphId), placement);
        }
        return Promise.resolve({ success: true });
      }
      case "dashboardWidgets.delete":
        state.widgets = state.widgets.filter((widget) => widget.id !== input.id);
        return Promise.resolve({ success: true });
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FLAG_ON = { release_dashboards: true };
const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = ["analytics:view", "cost:view", "traces:view"];
const LANGY_MEMBER = [...MEMBER, "langy:create"];
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
  flags = FLAG_ON,
}: {
  server: ReturnType<typeof inMemoryServer>;
  dashboardId?: string;
  query?: Record<string, string>;
  withSidebar?: boolean;
  userId?: string;
  permissions?: string[];
  flags?: Record<string, boolean>;
}) {
  const host = new StubAnalyticsHost({
    flags,
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

/** The picker's regions, by the name each section carries. */
async function pickerRegions() {
  const dialog = await screen.findByRole("dialog");
  return within(dialog)
    .queryAllByRole("region")
    .map((region) => region.getAttribute("aria-label"));
}

afterEach(cleanup);

const FLIGHT_DECK = BOARD_TEMPLATES.find(({ id }) => id === "cockpit")!;

describe("a member's board", () => {
  describe("given a member opens a board with nothing on it", () => {
    /** @scenario 'AC1 The empty board has no "Add a block" box' */
    /** @scenario "AC10 Blank board matches the reference" */
    /** @scenario "AC17 Every widget and template is listed, coming soon until it is built" */
    it("shows the template strip and no Add a block box", async () => {
      openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

      expect(await screen.findByText("Add a description")).toBeInTheDocument();
      expect(await screen.findByText("Start from a template")).toBeInTheDocument();
      expect(
        await screen.findByRole("button", {
          name: new RegExp(escape(FLIGHT_DECK.name)),
        }),
      ).toBeDisabled();
      expect(screen.getAllByText(/^Coming soon: \d+ of \d+ widgets built$/).length).toBe(
        BOARD_TEMPLATES.filter(({ comingSoon }) => comingSoon !== void 0).length,
      );
      expect(screen.queryByRole("button", { name: /Add a block/ })).toBeNull();
    });
  });

  describe("when the member starts from a template whose widgets are all built", () => {
    const READY = BOARD_TEMPLATES.find(({ comingSoon }) => comingSoon === void 0)!;

    /** @scenario "AC8 Starting from the template makes a new board of editable widgets" */
    it("makes a new board only they see, with every template widget, and opens it", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const { host } = openBoard({ server });

      await user.click(await screen.findByRole("button", { name: new RegExp(escape(READY.name)) }));

      await waitFor(() => expect(host.navigations).toHaveLength(1));
      const [created] = server.state.boards.slice(OWN_BOARDS.length);
      expect(created).toMatchObject({
        name: READY.name,
        visibility: "only_me",
        description: READY.description,
      });
      expect(host.navigations).toEqual([`/test-project/dashboards/${created!.id}`]);
      const onBoard = server.state.widgets.filter(({ dashboardId }) => dashboardId === created!.id);
      expect(onBoard.map(({ name }) => name).toSorted()).toEqual(
        READY.widgets.map(({ name }) => name).toSorted(),
      );
    });
  });

  describe("given the picker is open on the member's board with Langy", () => {
    const openPicker = (server = inMemoryServer({ boards: OWN_BOARDS })) => ({
      server,
      ...openBoard({
        server,
        query: { addBlock: "open" },
        flags: LANGY_ON,
        permissions: LANGY_MEMBER,
      }),
    });

    describe("when the member browses every section", () => {
      /** @scenario "AC12 Only working questions are offered" */
      /** @scenario "AC16 The picker offers every catalogue widget that has code, grouped by the question tree" */
      it("lists every question in its own section, and no Blocks section", async () => {
        openPicker();

        const dialog = await screen.findByRole("dialog");
        for (const section of PICKER_SECTIONS) {
          const listed = within(within(dialog).getByRole("region", { name: section.title }));
          expect(listed.getAllByRole("button")).toHaveLength(section.questions.length);
          for (const { question, comingSoon } of section.questions) {
            const row = listed.getByRole("button", { name: new RegExp(escape(question)) });
            expect(row.matches(":disabled"), question).toBe(comingSoon === true);
          }
        }
        expect(await pickerRegions()).toEqual(PICKER_SECTIONS.map(({ title }) => title));
        expect(within(dialog).queryByRole("region", { name: "Blocks" })).toBeNull();
      });
    });

    describe("when they choose a question", () => {
      const withExistingWidget = () =>
        inMemoryServer({
          boards: OWN_BOARDS,
          widgets: [storedWidget({ id: "w-1", dashboardId: "board-1", name: "Traces" })],
        });

      /** @scenario "AC12 A picked question adds its widget and seeds Langy" */
      it("closes the picker, adds the question's widget below the existing ones, and drafts Langy to send", async () => {
        const user = userEvent.setup();
        const { server, host } = openPicker(withExistingWidget());
        const traffic = PICKER_SECTIONS.flatMap(({ questions }) => questions).find(
          ({ id }) => id === "traffic",
        )!;

        await user.click(
          await screen.findByRole("button", { name: new RegExp(escape(traffic.question)) }),
        );

        await waitFor(() => expect(host.lastQuery).toEqual({ addBlock: void 0 }));
        const created = server.state.widgets.find(({ id }) => id === "widget-new-1")!;
        expect(created).toMatchObject({
          dashboardId: "board-1",
          name: traffic.question,
          gridRow: 3,
        });
        expect(host.langyAsks).toHaveLength(1);
        const [ask] = host.langyAsks;
        expect(ask?.question).toBeUndefined();
        expect(ask?.draft?.startsWith(traffic.prompt)).toBe(true);
        expect(ask?.draft).toContain("Dashboard period:");
        expect(ask?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
        expect(ask?.context[0]?.ref).toContain('dashboard "Weekly review" (id board-1)');
      });
    });

    describe("when the write fails", () => {
      /** @scenario "AC12c A failed add keeps the picker open and does not seed Langy" */
      it("keeps the picker open, seeds no Langy conversation, and stores no widget", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer({ boards: OWN_BOARDS, refuseWidgetCreate: true });
        const { host } = openPicker(server);
        const traffic = PICKER_SECTIONS.flatMap(({ questions }) => questions).find(
          ({ id }) => id === "traffic",
        )!;

        await user.click(
          await screen.findByRole("button", { name: new RegExp(escape(traffic.question)) }),
        );

        await waitFor(() => expect(callsTo(server, "dashboardWidgets.create")).toHaveLength(1));
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(host.langyAsks).toEqual([]);
        expect(server.state.widgets).toEqual([]);
      });
    });
  });

  describe("given the picker is open and Langy is not available to the member", () => {
    /** @scenario "AC12b Without Langy a picked question still adds its widget" */
    it.each([
      ["the release flag is off", FLAG_ON, LANGY_MEMBER],
      ["the member may not start a conversation", LANGY_ON, MEMBER],
    ])(
      "lists every question and no Ask Langy footer when %s",
      async (_case, flags, permissions) => {
        openBoard({
          server: inMemoryServer({ boards: OWN_BOARDS }),
          query: { addBlock: "open" },
          flags,
          permissions,
        });

        expect(await pickerRegions()).toEqual(PICKER_SECTIONS.map(({ title }) => title));
        for (const { question, comingSoon } of PICKER_SECTIONS.flatMap(
          ({ questions }) => questions,
        )) {
          const row = screen.getByRole("button", { name: new RegExp(escape(question)) });
          expect(row.matches(":disabled"), question).toBe(comingSoon === true);
        }
        expect(screen.queryByRole("button", { name: "Ask Langy" })).toBeNull();
      },
    );

    /** @scenario "AC12b Without Langy a picked question still adds its widget" */
    it("adds the picked question's widget and seeds no Langy conversation", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const { host } = openBoard({
        server,
        query: { addBlock: "open" },
        flags: FLAG_ON,
        permissions: MEMBER,
      });
      const overall = PICKER_SECTIONS.flatMap(({ questions }) => questions).find(
        ({ id }) => id === "ck-status",
      )!;

      await user.click(
        await screen.findByRole("button", { name: new RegExp(escape(overall.question)) }),
      );

      await waitFor(() => expect(callsTo(server, "dashboardWidgets.create")).toHaveLength(1));
      expect(callsTo(server, "dashboardWidgets.create")[0]?.input).toMatchObject({
        dashboardId: "board-1",
        name: overall.question,
      });
      expect(host.langyAsks).toEqual([]);
      expect(host.lastQuery).toEqual({ addBlock: void 0 });
    });
  });

  describe("when the member presses Add chart", () => {
    it("opens the widget drawer on a new widget, not the picker", async () => {
      const user = userEvent.setup();
      const { host } = openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

      await user.click(await screen.findByRole("button", { name: /Add chart/ }));

      expect(await screen.findByRole("dialog")).toHaveTextContent("New widget");
      expect(host.queries).toEqual([]);
    });
  });

  describe("given a board with widgets", () => {
    const boardWithTwoWidgets = () =>
      inMemoryServer({
        boards: OWN_BOARDS,
        widgets: [
          storedWidget({ id: "w-1", dashboardId: "board-1", name: "Traces" }),
          storedWidget({ id: "w-2", dashboardId: "board-1", name: "Cost", gridRow: 3 }),
        ],
      });

    /** The window and grain each widget's frame was handed to bind its reserved parameters. */
    const contextsHanded = async (query: Record<string, string>) => {
      const frames = recordWidgetFrames();
      try {
        openBoard({ server: boardWithTwoWidgets(), query });
        const iframes = await screen.findAllByTitle("Custom chart");
        return frames.loadAll(iframes).map(({ dashboardContext }) => ({
          spanMs: dashboardContext.timeWindow.end - dashboardContext.timeWindow.start,
          granularitySeconds: dashboardContext.granularitySeconds,
        }));
      } finally {
        frames.restore();
      }
    };

    describe("when the member changes the period", () => {
      /** @scenario "AC13 Period and grain update every block" */
      it("reads every widget over the chosen period", async () => {
        const day = await contextsHanded({ range: "24h" });
        cleanup();
        const week = await contextsHanded({ range: "7d" });

        expect(day.map(({ spanMs }) => spanMs)).toEqual([86_400_000, 86_400_000]);
        expect(week.map(({ spanMs }) => spanMs)).toEqual([604_800_000, 604_800_000]);
      });

      /** @scenario "AC13 Period and grain update every block" */
      it("writes the chosen range to the address the whole board reads", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host } = openBoard({ server: boardWithTwoWidgets() });

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
      ])("reads every widget at %s buckets", async (grain, range, seconds) => {
        const handed = await contextsHanded({ range, grain });

        expect(handed.map(({ granularitySeconds }) => granularitySeconds)).toEqual([
          seconds,
          seconds,
        ]);
      });

      /** @scenario "AC13 Grain choices update every block" */
      it("offers auto, 1h, 1d and 1w, none of them held back", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host } = openBoard({ server: boardWithTwoWidgets() });

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

  describe("given a widget on a board", () => {
    const boardWithOneWidget = () =>
      inMemoryServer({
        boards: OWN_BOARDS,
        widgets: [storedWidget({ id: "w-1", dashboardId: "board-1", name: "Traces" })],
      });

    const chooseFromWidgetMenu = async ({ name }: { name: RegExp }) => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));
      await user.click(await screen.findByRole("menuitem", { name }));
    };

    /** Unmounts everything, then opens the board again on fresh caches. */
    const reload = (server: ReturnType<typeof inMemoryServer>) => {
      cleanup();
      openBoard({ server });
    };

    describe("when the member clicks the footer's Add a block box", () => {
      /** @scenario "AC10 A non-empty board still offers a way to add a widget" */
      it("opens the picker", async () => {
        const user = userEvent.setup();
        const { host } = openBoard({ server: boardWithOneWidget() });

        await user.click(await screen.findByRole("button", { name: /Add a block/ }));

        expect(host.lastQuery).toEqual({ addBlock: "open" });
      });
    });

    describe("when the member opens its menu", () => {
      /** @scenario "AC15 Widget menu actions persist after reload" */
      it("offers Edit, Duplicate and Delete, and nothing else", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        openBoard({ server: boardWithOneWidget() });

        await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));

        const items = await screen.findAllByRole("menuitem");
        expect(items.map((item) => item.textContent?.trim())).toEqual([
          "Edit",
          "Duplicate",
          "Delete",
        ]);
      });
    });

    describe("when the member edits it", () => {
      /** @scenario "AC15 Widget menu actions persist after reload" */
      it("opens the widget drawer on that widget", async () => {
        openBoard({ server: boardWithOneWidget() });

        await chooseFromWidgetMenu({ name: /Edit/ });

        expect(await screen.findByRole("dialog")).toHaveTextContent("Traces");
      });
    });

    describe("when the member duplicates it", () => {
      /** @scenario "AC15 Widget menu actions persist after reload" */
      it("shows both copies after reload, the copy below the original", async () => {
        const server = boardWithOneWidget();
        openBoard({ server });

        await chooseFromWidgetMenu({ name: /Duplicate/ });
        await waitFor(() =>
          expect(callsTo(server, "dashboardWidgets.updateLayout")).toHaveLength(1),
        );
        reload(server);

        await waitFor(() =>
          expect(screen.getAllByRole("button", { name: "Actions for Traces" })).toHaveLength(2),
        );
        expect(callsTo(server, "dashboardWidgets.create")[0]?.input).toMatchObject({
          dashboardId: "board-1",
          name: "Traces",
          code: WIDGET_CODE,
        });
        expect(server.state.widgets.map(({ gridRow }) => gridRow)).toEqual([0, 3]);
      });
    });

    describe("when the member deletes it", () => {
      /** @scenario "AC15 Widget menu actions persist after reload" */
      it("shows the blank board after reload", async () => {
        const server = boardWithOneWidget();
        openBoard({ server });

        await chooseFromWidgetMenu({ name: /Delete/ });
        await waitFor(() => expect(callsTo(server, "dashboardWidgets.delete")).toHaveLength(1));
        reload(server);

        expect(await screen.findByText("Start from a template")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Actions for Traces" })).toBeNull();
      });
    });
  });
});
