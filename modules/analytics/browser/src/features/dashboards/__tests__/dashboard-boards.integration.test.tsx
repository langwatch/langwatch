/**
 * @vitest-environment jsdom
 * A member's boards against an in-memory dashboards and widgets server: the
 * header, the blank board and its way to the templates library, the picker
 * (questions for Langy), the period and the widget menu.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { AGENT_KIND_CHIP_LABELS, PICKER_QUESTIONS, PICKER_SECTIONS } from "../catalogue/index.ts";
import { boardSubject } from "../langy/model/board-langy.ts";
import { BlockPickerDialog } from "../ui/sections/block-picker-dialog.tsx";
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
  createdById: string | null;
  isStarred: boolean;
  updatedAt: Date;
};
type Widget = {
  id: string;
  dashboardId: string | null;
  name: string;
  graph: {
    version: 1;
    code: string;
    queries: { name: string; sql: string }[];
    description?: string;
    prompt?: string;
    source?: Record<string, unknown>;
  };
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
  description,
}: {
  id: string;
  dashboardId: string;
  name: string;
  gridRow?: number;
  description?: string;
}): Widget {
  return {
    id,
    dashboardId,
    name,
    graph: {
      version: 1,
      code: WIDGET_CODE,
      queries: [{ name: "main", sql: "SELECT 1" }],
      ...(description === undefined ? {} : { description }),
    },
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
  refuseWidgetCreate = false,
}: {
  boards: Board[];
  widgets?: Widget[];
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
          createdById: "user-1",
          isStarred: false,
          updatedAt: new Date("2026-01-01"),
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
      case "dashboards.listStarred":
        return Promise.resolve(
          state.boards
            .filter((each) => each.isStarred)
            .map((each) => ({ kind: "board", dashboard: { ...each } })),
        );
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
            ...(input.description === undefined
              ? {}
              : { description: input.description as string }),
            ...(input.prompt === undefined ? {} : { prompt: input.prompt as string }),
            ...(input.source === undefined ? {} : { source: input.source as Input }),
          },
          gridColumn: 0,
          gridRow: 0,
          colSpan: 4,
          rowSpan: 3,
        };
        state.widgets.push(widget);
        return Promise.resolve({ ...widget, definition: widget.graph });
      }
      case "dashboardWidgets.update": {
        const edited = find(input.id);
        if (input.name !== undefined) edited.name = input.name as string;
        edited.graph = {
          ...edited.graph,
          code: String(input.code),
          queries: input.queries as Widget["graph"]["queries"],
        };
        return Promise.resolve({ success: true });
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

const TOTAL = PICKER_QUESTIONS.length;

/** One chip in the picker's "Categories" or "Agent types" row; its name ends with its count. */
const chip = ({ row, name }: { row: string; name: string }) =>
  within(screen.getByRole("group", { name: row })).getByRole("button", {
    name: new RegExp(`^${escape(name)}\\s*\\d+$`),
  });

/** A chip's whole text: its words, then its count. */
const chipText = ({ name, count }: { name: string; count: number }) =>
  new RegExp(`^${escape(name)}\\s*${count}$`);

/** Every picker row's add button, across the sections. */
const rowButtons = () =>
  within(screen.getByRole("dialog"))
    .getAllByRole("region")
    .flatMap((region) => within(region).getAllByRole("button"));

const FLAG_ON = { release_dashboards: true };
const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = ["analytics:view", "cost:view", "traces:view"];
const LANGY_MEMBER = [...MEMBER, "langy:create"];
const OWN_BOARDS: Board[] = [
  {
    id: "board-1",
    name: "Weekly review",
    description: null,
    createdById: "user-1",
    isStarred: false,
    updatedAt: new Date("2026-01-01"),
  },
  {
    id: "board-2",
    name: "Latency",
    description: null,
    createdById: "user-1",
    isStarred: false,
    updatedAt: new Date("2026-01-01"),
  },
];

const STARRED_BOARDS: Board[] = OWN_BOARDS.map((each) => ({ ...each, isStarred: true }));

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
        {withSidebar && <SavedDashboardsSection openPath={dashboardId} />}
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

describe("a member's board", () => {
  describe("given a member opens a board with nothing on it", () => {
    /** @scenario "Boards: every empty board shows one view" */
    it("shows the ask bar, the suggested questions and the From LangWatch boards to start from", async () => {
      openBoard({
        server: inMemoryServer({ boards: OWN_BOARDS }),
        flags: LANGY_ON,
        permissions: LANGY_MEMBER,
      });

      expect(await screen.findByText("Or start from a template")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "What do you want to know?" })).toBeInTheDocument();
      for (const question of ["Where does my money go?", "Is quality holding?"]) {
        expect(screen.getByRole("button", { name: question })).toBeInTheDocument();
      }
      const start = within(screen.getByRole("region", { name: "Start from a template" }));
      expect(start.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
        "/test-project/dashboards/curated/release",
        "/test-project/dashboards/curated/data",
        "/test-project/dashboards/curated/breaks",
        "/test-project/dashboards/templates",
      ]);
      expect(start.getByRole("link", { name: "View all templates" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Add a widget Start/ })).toBeNull();
    });

    describe("when the member opens a From LangWatch card", () => {
      /** @scenario "Boards: every empty board shows one view" */
      it("opens that live board", async () => {
        const user = userEvent.setup();
        const { host } = openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

        await user.click(await screen.findByRole("link", { name: "Release check" }));

        expect(host.navigations).toEqual(["/test-project/dashboards/curated/release"]);
      });
    });

    describe("when Langy is not available to the member", () => {
      /** @scenario "Boards: every board has the ask bar" */
      it("keeps the ask bar for finding a widget, with no suggested questions", async () => {
        openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

        expect(
          await screen.findByRole("button", { name: "What do you want to know?" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Where does my money go?" })).toBeNull();
      });
    });

    describe("when the member clicks the ask bar", () => {
      /** @scenario "Boards: the ask bar opens its modal on a click, with the cursor in the modal" */
      it("opens Add a widget with the cursor in its search", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer({ boards: OWN_BOARDS });
        const { host } = openBoard({ server });

        await user.click(await screen.findByRole("button", { name: "What do you want to know?" }));

        expect(host.lastQuery).toEqual({ addBlock: "open" });
      });
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
      it("lists every built widget in its own section, and no Blocks section", async () => {
        openPicker();

        const dialog = await screen.findByRole("dialog");
        for (const section of PICKER_SECTIONS) {
          const listed = within(within(dialog).getByRole("region", { name: section.title }));
          expect(listed.getAllByRole("button")).toHaveLength(section.questions.length);
          for (const { question } of section.questions) {
            const row = listed.getByRole("button", { name: new RegExp(escape(question)) });
            expect(row, question).toBeEnabled();
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
        // One role query for the whole list: a named query per question timed out in CI.
        const rows = within(screen.getByRole("dialog")).getAllByRole("button");
        for (const { question } of PICKER_SECTIONS.flatMap(({ questions }) => questions)) {
          expect(
            rows.find((button) => button.textContent?.includes(question)),
            question,
          ).toBeDefined();
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

  describe("given the picker is open with its filter chips", () => {
    const openPicker = (server = inMemoryServer({ boards: OWN_BOARDS })) => ({
      server,
      ...openBoard({
        server,
        query: { addBlock: "open" },
        flags: LANGY_ON,
        permissions: LANGY_MEMBER,
      }),
    });

    describe("when it opens", () => {
      /** @scenario "AC130 Picker filters: the picker offers the finder's search and chips" */
      it("offers the search, the categories on All, the agent types, Skip and Ask Langy", async () => {
        openPicker();

        const dialog = await screen.findByRole("dialog");
        expect(screen.getByRole("searchbox", { name: "Search widgets" })).toHaveValue("");
        const all = chip({ row: "Categories", name: "All" });
        expect(all).toHaveAttribute("aria-pressed", "true");
        expect(all).toHaveTextContent(chipText({ name: "All", count: TOTAL }));
        expect(chip({ row: "Categories", name: "Grow" })).toBeInTheDocument();
        const types = within(screen.getByRole("group", { name: "Agent types" }));
        expect(types.getByRole("button", { name: /^Voice agent\s*\d+$/ })).toBeInTheDocument();
        expect(types.queryByRole("button", { name: /^Coding agent/ })).toBeNull();
        expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ask Langy" })).toBeInTheDocument();
        expect(dialog.textContent).not.toMatch(/\bblocks?\b/i);
      });

      /** @scenario "AC134 Picker filters: sections are branches in tree order, coloured by trunk" */
      it("marks each branch section with its trunk, the trunks in order", async () => {
        openPicker();

        const regions = within(await screen.findByRole("dialog")).getAllByRole("region");
        expect(regions.map((region) => region.getAttribute("data-trunk"))).toEqual(
          PICKER_SECTIONS.map(({ trunk }) => trunk),
        );
      });
    });

    describe("when the member picks a category", () => {
      /**
       * @scenario "AC131 Picker filters: chips narrow the widgets by category and agent type"
       * @scenario "AC132 Picker filters: each chip counts the widgets it would show"
       */
      it("lists only that category's widgets, and picking it again lists every widget", async () => {
        const user = userEvent.setup();
        openPicker();
        const protect = PICKER_QUESTIONS.filter(({ trunk }) => trunk === "Protect");

        await screen.findByRole("dialog");
        expect(chip({ row: "Categories", name: "Protect" })).toHaveTextContent(
          chipText({ name: "Protect", count: protect.length }),
        );
        await user.click(chip({ row: "Categories", name: "Protect" }));

        expect(chip({ row: "Categories", name: "Protect" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(rowButtons()).toHaveLength(protect.length);
        const regions = within(screen.getByRole("dialog")).getAllByRole("region");
        expect(regions.every((region) => region.getAttribute("data-trunk") === "Protect")).toBe(
          true,
        );
        expect(chip({ row: "Categories", name: "All" })).toHaveTextContent(
          chipText({ name: "All", count: TOTAL }),
        );

        await user.click(chip({ row: "Categories", name: "Protect" }));
        expect(chip({ row: "Categories", name: "All" })).toHaveAttribute("aria-pressed", "true");
        expect(rowButtons()).toHaveLength(TOTAL);
      });
    });

    describe("when the member picks an agent type", () => {
      /** @scenario "AC131 Picker filters: chips narrow the widgets by category and agent type" */
      it("lists only the widgets made for that type, each naming it on its row", async () => {
        const user = userEvent.setup();
        openPicker();
        const voice = AGENT_KIND_CHIP_LABELS.voice;
        const madeForVoice = PICKER_QUESTIONS.filter(({ madeFor }) => madeFor.includes("voice"));

        await screen.findByRole("dialog");
        await user.click(chip({ row: "Agent types", name: voice }));

        expect(chip({ row: "Agent types", name: voice })).toHaveAttribute("aria-pressed", "true");
        expect(rowButtons()).toHaveLength(madeForVoice.length);
        for (const row of rowButtons()) expect(row).toHaveTextContent(voice);
      });
    });

    describe("given a widget made for a few agent types", () => {
      /** @scenario "AC138 Picker filters: a row names the agent types its widget is made for" */
      it("names them on its row, and a general widget names none", async () => {
        openPicker();
        const made = PICKER_QUESTIONS.find(({ madeFor }) => madeFor.length > 0)!;
        const general = PICKER_QUESTIONS.find(({ madeFor }) => madeFor.length === 0)!;

        const dialog = await screen.findByRole("dialog");
        const row = (id: string) => dialog.querySelector(`[data-widget="${id}"]`);
        for (const kind of made.madeFor) {
          expect(row(made.id)).toHaveTextContent(AGENT_KIND_CHIP_LABELS[kind]);
        }
        expect(row(general.id)?.textContent).toBe(`${general.question}${general.why}`);
      });
    });

    describe("when the member presses Skip", () => {
      /** @scenario "Finder: Skip in Add a widget hands over to the widget editor" */
      it("hands over to the widget editor and adds or drafts nothing", async () => {
        const user = userEvent.setup();
        const skips: string[] = [];
        const added: string[] = [];
        const host = new StubAnalyticsHost({ flags: LANGY_ON, permissions: LANGY_MEMBER });
        renderDashboards({
          element: (
            <BlockPickerDialog
              board={boardSubject({ board: { id: "board-1", name: "Weekly review" }, widgets: [] })}
              period={{
                periodStart: Date.UTC(2026, 8, 1),
                periodEnd: Date.UTC(2026, 8, 8),
                granularitySeconds: 86_400,
              }}
              onAddWidgets={(question) => {
                added.push(question.id);
                return Promise.resolve(true);
              }}
              onSkip={() => skips.push("skip")}
              onClose={() => void 0}
            />
          ),
          host,
        });

        await user.click(await screen.findByRole("button", { name: "Skip" }));

        expect(skips).toEqual(["skip"]);
        expect(added).toEqual([]);
        expect(host.langyAsks).toEqual([]);
      });
    });

    describe("when the member picks a built widget from a narrowed list", () => {
      /**
       * @scenario "AC135 Picker filters: a widget picked from a filtered list is added and drafts its Langy prompt"
       * @scenario "AC141 Picker add: a picked widget drafts its own prompt with the widget, as Ask Langy does"
       */
      it("closes the picker, stores the widget and drafts its prompt for Langy", async () => {
        const user = userEvent.setup();
        const { server, host } = openPicker();
        const traffic = PICKER_QUESTIONS.find(({ id }) => id === "traffic")!;

        await screen.findByRole("dialog");
        await user.click(chip({ row: "Categories", name: traffic.trunk }));
        await user.click(
          screen.getByRole("button", { name: new RegExp(escape(traffic.question)) }),
        );

        await waitFor(() => expect(host.lastQuery).toEqual({ addBlock: void 0 }));
        expect(server.state.widgets.map(({ name }) => name)).toEqual([traffic.question]);
        expect(host.langyAsks).toHaveLength(1);
        expect(host.langyAsks[0]?.draft?.startsWith(traffic.prompt)).toBe(true);
        expect(host.langyAsks[0]?.draft).toContain(`This widget:\nName: ${traffic.question}`);
        expect(host.langyAsks[0]?.draft).toContain("Queries (LangWatchQL):");
      });
    });

    describe("given a search and chips that match nothing", () => {
      /** @scenario "AC137 Picker filters: no match says so and offers to clear the search and filters" */
      it("says so, and clearing lists every widget again", async () => {
        const user = userEvent.setup();
        openPicker();

        await screen.findByRole("dialog");
        await user.click(chip({ row: "Categories", name: "Profit" }));
        fireEvent.change(screen.getByRole("searchbox", { name: "Search widgets" }), {
          target: { value: "zzz-no-such-widget" },
        });

        expect(
          screen.getByText("No widget matches. Skip to write your own with Langy."),
        ).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Clear search and filters" }));

        expect(await pickerRegions()).toEqual(PICKER_SECTIONS.map(({ title }) => title));
        expect(screen.getByRole("searchbox", { name: "Search widgets" })).toHaveValue("");
      });
    });
  });

  describe("given the member narrowed the picker and closed it", () => {
    /** Stands in for the board: the picker unmounts on close, and a button opens it again. */
    function ReopenablePicker() {
      const [isOpen, setIsOpen] = useState(true);
      if (!isOpen) {
        return (
          <button type="button" onClick={() => setIsOpen(true)}>
            Open the picker again
          </button>
        );
      }
      return (
        <BlockPickerDialog
          board={boardSubject({ board: { id: "board-1", name: "Weekly review" }, widgets: [] })}
          period={{
            periodStart: Date.UTC(2026, 8, 1),
            periodEnd: Date.UTC(2026, 8, 8),
            granularitySeconds: 86_400,
          }}
          onAddWidgets={() => Promise.resolve(true)}
          onSkip={() => setIsOpen(false)}
          onClose={() => setIsOpen(false)}
        />
      );
    }

    /** @scenario "AC136 Picker filters: the filters reset when the picker closes" */
    it("opens again with an empty search, the categories on All, no agent type and nothing in the address", async () => {
      const user = userEvent.setup();
      const host = new StubAnalyticsHost({ flags: LANGY_ON, permissions: LANGY_MEMBER });
      renderDashboards({ element: <ReopenablePicker />, host });

      const dialog = await screen.findByRole("dialog");
      await user.click(chip({ row: "Agent types", name: AGENT_KIND_CHIP_LABELS.voice }));
      await user.click(chip({ row: "Categories", name: "Protect" }));
      fireEvent.change(screen.getByRole("searchbox", { name: "Search widgets" }), {
        target: { value: "latency" },
      });
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      await user.click(await screen.findByRole("button", { name: "Open the picker again" }));

      await screen.findByRole("dialog");
      expect(screen.getByRole("searchbox", { name: "Search widgets" })).toHaveValue("");
      expect(chip({ row: "Categories", name: "All" })).toHaveAttribute("aria-pressed", "true");
      const types = within(screen.getByRole("group", { name: "Agent types" }));
      for (const type of types.getAllByRole("button")) {
        expect(type).toHaveAttribute("aria-pressed", "false");
      }
      expect(host.lastQuery).toBeUndefined();
    });
  });

  describe("when the member presses Add a widget in the header", () => {
    /** @scenario "AC10 A non-empty board still offers a way to add a widget" */
    it("opens the picker", async () => {
      const user = userEvent.setup();
      const { host } = openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

      await user.click(await screen.findByRole("button", { name: "Add a widget" }));

      expect(host.lastQuery).toEqual({ addBlock: "open" });
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
    describe("when they rename it from the sidebar", () => {
      /** @scenario "AC14 Rename and describe" */
      it("saves the name and shows it on the board and in the sidebar", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = inMemoryServer({ boards: OWN_BOARDS });
        openBoard({ server, withSidebar: true });

        await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
        await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
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
          within(screen.getByRole("list", { name: "Your dashboards" })).getByRole("link", {
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

  describe("given a member's board", () => {
    /** @scenario "Boards: no star or pencil by the board title" */
    it("has no star and no rename pencil by its title", async () => {
      openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

      expect(await screen.findByRole("heading", { name: "Weekly review" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Star dashboard|Unstar dashboard/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rename dashboard" })).toBeNull();
    });
  });

  describe("given the member's own My dashboard", () => {
    /** @scenario "Boards: My dashboard has no description placeholder" */
    it("offers no description placeholder", async () => {
      openBoard({
        server: inMemoryServer({
          boards: [{ ...OWN_BOARDS[0]!, id: "mine", name: "My dashboard" }],
        }),
        dashboardId: "mine",
      });

      expect(await screen.findByRole("heading", { name: "My dashboard" })).toBeInTheDocument();
      expect(screen.queryByText("Add a description")).toBeNull();
    });
  });

  describe("given any board with the sidebar beside it", () => {
    /** @scenario "AC159 No sharing control appears anywhere" */
    it("offers no visibility or share control in the header or the sidebar menu", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = inMemoryServer({ boards: STARRED_BOARDS });
      openBoard({ server, withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
      await screen.findByRole("menuitem", { name: "Delete" });

      expect(screen.queryByRole("menuitem", { name: /share|default/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /visibility|share/i })).toBeNull();
      expect(screen.queryByText(/only me|organisation/i)).toBeNull();
    });
  });

  describe("given widgets with and without a description", () => {
    const DESCRIPTION = "Every trace that arrived\n\nTraces per bucket, with the period total.";
    const server = () =>
      inMemoryServer({
        boards: OWN_BOARDS,
        widgets: [
          storedWidget({
            id: "w-1",
            dashboardId: "board-1",
            name: "Traces",
            description: DESCRIPTION,
          }),
          storedWidget({ id: "w-2", dashboardId: "board-1", name: "Latency", gridRow: 3 }),
        ],
      });

    /** @scenario "AC111 Widget description: the card shows the description behind an info icon" */
    it("shows an info icon on the described card that reveals its description", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      openBoard({ server: server() });

      const info = await screen.findByRole("button", { name: "About Traces" });
      await user.hover(info);

      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent("Every trace that arrived");
      expect(tooltip).toHaveTextContent("Traces per bucket, with the period total.");
    });

    /** @scenario "AC112 Widget description: a widget without a description has no info icon" */
    it("shows no info icon on the card without one", async () => {
      openBoard({ server: server() });

      expect(
        await screen.findByRole("button", { name: "Actions for Latency" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "About Latency" })).toBeNull();
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

    describe("when the member clicks the footer's Add a widget box", () => {
      /** @scenario "AC10 A non-empty board still offers a way to add a widget" */
      it("opens the picker", async () => {
        const user = userEvent.setup();
        const { host } = openBoard({ server: boardWithOneWidget() });

        await user.click(await screen.findByRole("button", { name: /^Add a widget Start/ }));

        expect(host.lastQuery).toEqual({ addBlock: "open" });
      });
    });

    describe("when the member opens its menu", () => {
      /** @scenario "AC15 Widget menu actions persist after reload" */
      it("offers Edit code, the two copies, Duplicate and Delete, and nothing else", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        openBoard({ server: boardWithOneWidget() });

        await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));

        const items = await screen.findAllByRole("menuitem");
        expect(items.map((item) => item.textContent?.trim())).toEqual([
          "Edit code",
          "Copy widget id",
          "Copy API snippet",
          "Duplicate",
          "Delete",
        ]);
      });
    });

    describe("when the member edits it", () => {
      /** @scenario "AC15 Widget menu actions persist after reload" */
      it("opens the widget editor on that widget, at its own address", async () => {
        const server = boardWithOneWidget();
        const { host } = openBoard({ server });

        await chooseFromWidgetMenu({ name: /Edit code/ });
        expect(host.lastQuery).toEqual({ editWidget: "w-1" });

        cleanup();
        openBoard({ server, query: { editWidget: "w-1" } });
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

        expect(await screen.findByText("Or start from a template")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Actions for Traces" })).toBeNull();
      });
    });
  });
});
