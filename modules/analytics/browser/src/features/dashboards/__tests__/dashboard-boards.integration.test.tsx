/**
 * @vitest-environment jsdom
 * A member's boards against an in-memory dashboards and widgets server: the
 * header, the blank board and its way to the templates library, the picker
 * (questions for Langy), the period and the widget menu.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import { afterDraftWrites } from "../behavior/use-draft-board.ts";
import {
  AGENT_KIND_CHIP_LABELS,
  CODING_PICKER_QUESTIONS,
  PICKER_QUESTIONS,
  PICKER_SECTIONS,
  pickerSections,
} from "../catalogue/index.ts";
import { boardSubject } from "../langy/model/board-langy.ts";
import { curatedBoardById } from "../model/curated-boards.ts";
import { finderPool } from "../model/template-library.ts";
import { BlockPickerDialog } from "../ui/sections/block-picker-dialog.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import {
  HOME_BOARD,
  NO_PROCEDURES,
  recordWidgetFrames,
  renderDashboards,
} from "./render-dashboards.test-helpers.tsx";

// jsdom loads no stylesheet, so the theme colours a chart frame is handed have no value to read.
vi.mock(import("@langwatch/design-system/color-mode"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRawColorValue: () => "#123456",
}));

type Board = typeof HOME_BOARD & {
  id: string;
  name: string;
  description: string | null;
  createdById: string | null;
  myDashboardOfUserId?: string | null;
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
  refuseBoardCreates = 0,
  refuseBoardUpdates = 0,
  holdBoardCreates = false,
}: {
  boards: Board[];
  widgets?: Widget[];
  /** Answers `dashboardWidgets.create` as the server does when the write is rejected. */
  refuseWidgetCreate?: boolean;
  /** How many `boards.create` calls the server turns away before it makes one. */
  refuseBoardCreates?: number;
  /** How many `boards.update` calls the server turns away before it takes one. */
  refuseBoardUpdates?: number;
  /** Holds every `boards.create` answer until the test releases them. */
  holdBoardCreates?: boolean;
}) {
  let boardCreatesLeftToRefuse = refuseBoardCreates;
  let boardUpdatesLeftToRefuse = refuseBoardUpdates;
  const heldCreates: (() => void)[] = [];
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
      case "boards.getAll":
        return Promise.resolve(state.boards.map((each) => ({ ...each })));
      case "boards.create": {
        if (boardCreatesLeftToRefuse > 0) {
          boardCreatesLeftToRefuse -= 1;
          return Promise.reject(new UiProcedureRefusal("resource_limit_exceeded", 403));
        }
        const make = () => {
          const created: Board = {
            ...HOME_BOARD,
            id: `board-new-${state.boards.length + 1}`,
            name: String(input.name),
            description: null,
            createdById: "user-1",
            isStarred: false,
            updatedAt: new Date("2026-01-01"),
          };
          state.boards.push(created);
          return { ...created };
        };
        if (!holdBoardCreates) return Promise.resolve(make());
        return new Promise((resolve) => heldCreates.push(() => resolve(make())));
      }
      case "boards.update": {
        if (boardUpdatesLeftToRefuse > 0) {
          boardUpdatesLeftToRefuse -= 1;
          return Promise.reject(new UiProcedureRefusal("dashboard_not_found", 404));
        }
        const updated = board(input.dashboardId);
        if (input.name !== void 0) updated.name = input.name as string;
        if (input.description !== void 0) updated.description = input.description as string | null;
        return Promise.resolve({ ...updated });
      }
      case "featureFlag.isEnabledForEachOrganization":
        return Promise.resolve({ enabledByOrganizationId: { "org-1": true } });
      case "boards.listStarred":
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
  /** Answers the held `boards.create` calls, in the order they came. */
  const releaseBoardCreates = () => {
    for (const release of heldCreates.splice(0)) release();
  };
  return { state, answer, releaseBoardCreates };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TOTAL = PICKER_QUESTIONS.length;

/** One chip in the picker's "Categories" or "Agent types" row; its name ends with its count. */
const chip = ({ row, name }: { row: string; name: string }) =>
  within(screen.getByRole("group", { name: row })).getByRole("button", {
    name: new RegExp(`^${escape(name)}\\s*\\d+$`),
  });

/** The picker's search: the ask bar as a field, named by the bar's words. */
const pickerSearch = () => screen.getByRole("searchbox", { name: "What do you want to know?" });

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
const MEMBER = [...ANALYTICS_MEMBER_PERMISSIONS];
const LANGY_MEMBER = [...MEMBER, "langy:create"];
const OWN_BOARDS: Board[] = [
  {
    ...HOME_BOARD,
    id: "board-1",
    name: "Weekly review",
    description: null,
    createdById: "user-1",
    isStarred: false,
    updatedAt: new Date("2026-01-01"),
  },
  {
    ...HOME_BOARD,
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
  projectPermissions,
  flags = FLAG_ON,
}: {
  server: ReturnType<typeof inMemoryServer>;
  dashboardId?: string;
  query?: Record<string, string>;
  withSidebar?: boolean;
  userId?: string;
  permissions?: string[];
  /** Grants by project id, which a rename asks of the project that owns the board. */
  projectPermissions?: Record<string, string[]>;
  flags?: Record<string, boolean>;
}) {
  const host = new StubAnalyticsHost({
    flags,
    userId,
    permissions,
    ...(projectPermissions ? { projectPermissions } : {}),
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

/** The one region "All" lists every widget in. */
const ALL_WIDGETS = ["All widgets"];

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
    /**
     * @scenario "Boards: every empty board shows one view"
     * @scenario "Only an empty LLM Ops board offers templates"
     */
    it("shows the ask bar, the suggested questions and every template with the chips", async () => {
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
      expect(start.getByRole("group", { name: "Categories" })).toBeInTheDocument();
      expect(start.getByRole("group", { name: "Agent types" })).toBeInTheDocument();
      expect(
        start
          .getAllByRole("button", { name: /^Use / })
          .map((each) => each.getAttribute("aria-label")),
      ).toEqual(finderPool({}).map(({ board }) => `Use ${board.name}`));
      expect(start.queryByRole("link", { name: "View all templates" })).toBeNull();
      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Add a widget Start/ })).toBeNull();
    });

    describe("when the board is homed in Gateway", () => {
      /** @scenario "Only an empty LLM Ops board offers templates" */
      it("offers no template, and keeps the ask bar, its questions and Add a widget", async () => {
        openBoard({
          server: inMemoryServer({
            boards: OWN_BOARDS.map((each) => ({ ...each, homeProduct: "gateway" as const })),
          }),
          flags: LANGY_ON,
          permissions: LANGY_MEMBER,
        });

        expect(
          await screen.findByRole("button", { name: "Where does my money go?" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "What do you want to know?" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add a widget" })).toBeInTheDocument();
        expect(screen.queryByText("Or start from a template")).toBeNull();
      });
    });

    describe("when the member uses a template", () => {
      /** @scenario "Boards: a template used on an empty board fills that board" */
      it("fills this board with its widgets and its job, keeping the board's own name", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer({ boards: OWN_BOARDS });
        const { host } = openBoard({ server });
        const template = curatedBoardById("data")!.card.board;

        await user.click(await screen.findByRole("button", { name: `Use ${template.name}` }));

        await waitFor(() => expect(server.state.widgets).toHaveLength(template.widgets.length));
        expect(server.state.widgets.every(({ dashboardId }) => dashboardId === "board-1")).toBe(
          true,
        );
        expect(callsTo(server, "boards.create")).toEqual([]);
        expect(callsTo(server, "boards.update").map(({ input }) => input)).toEqual([
          { projectId: "proj-1", dashboardId: "board-1", description: template.description },
        ]);
        expect(host.navigations).toEqual([]);
        await waitFor(() => expect(screen.queryByText("Or start from a template")).toBeNull());
      });

      /** @scenario "Boards: a template used on an empty board fills that board" */
      it("names an untitled board after the template", async () => {
        const user = userEvent.setup();
        const untitled = { ...OWN_BOARDS[0]!, name: "Untitled dashboard 1", description: "Mine" };
        const server = inMemoryServer({ boards: [untitled, OWN_BOARDS[1]!] });
        openBoard({ server });
        const template = curatedBoardById("data")!.card.board;

        await user.click(await screen.findByRole("button", { name: `Use ${template.name}` }));

        await waitFor(() => expect(callsTo(server, "boards.update")).toHaveLength(1));
        expect(callsTo(server, "boards.update")[0]?.input).toEqual({
          projectId: "proj-1",
          dashboardId: "board-1",
          name: template.name,
        });
      });
    });

    describe("when the template's widgets cannot be added", () => {
      /** @scenario "Boards: a template used on an empty board fills that board" */
      it("leaves the member on the empty board and says so", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer({ boards: OWN_BOARDS, refuseWidgetCreate: true });
        const { host } = openBoard({ server });

        await user.click(
          await screen.findByRole("button", {
            name: `Use ${curatedBoardById("release")!.card.board.name}`,
          }),
        );

        await waitFor(() =>
          expect(host.failures).toEqual([
            expect.objectContaining({
              fallbackTitle: "Couldn't add the template to this dashboard",
            }),
          ]),
        );
        expect(host.navigations).toEqual([]);
        expect(callsTo(server, "boards.update")).toEqual([]);
        expect(screen.getByText("Or start from a template")).toBeInTheDocument();
      });

      /** @scenario "Boards: a template used on an empty board fills that board" */
      it("takes the widgets back out when the board's description is refused", async () => {
        const user = userEvent.setup();
        const server = inMemoryServer({ boards: OWN_BOARDS, refuseBoardUpdates: 1 });
        const { host } = openBoard({ server });
        const template = curatedBoardById("release")!.card.board;

        await user.click(await screen.findByRole("button", { name: `Use ${template.name}` }));

        await waitFor(() =>
          expect(host.failures).toEqual([
            expect.objectContaining({
              fallbackTitle: "Couldn't add the template to this dashboard",
            }),
          ]),
        );
        const created = callsTo(server, "dashboardWidgets.create");
        expect(created).toHaveLength(template.widgets.length);
        await waitFor(() =>
          expect(callsTo(server, "dashboardWidgets.delete")).toHaveLength(template.widgets.length),
        );
        expect(await screen.findByText("Or start from a template")).toBeInTheDocument();
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
      /** @scenario "AC16 The picker offers every catalogue widget that has code, most asked-about first" */
      it("lists every built widget in one ranked list, each tagged with its branch", async () => {
        openPicker();

        const dialog = await screen.findByRole("dialog");
        expect(await pickerRegions()).toEqual(ALL_WIDGETS);
        const rows = within(
          within(dialog).getByRole("region", { name: "All widgets" }),
        ).getAllByRole("button");
        expect(rows.map((row) => row.getAttribute("data-widget"))).toEqual(
          PICKER_QUESTIONS.map(({ id }) => id),
        );
        for (const [index, { question, branch }] of PICKER_QUESTIONS.entries()) {
          expect(rows[index], question).toBeEnabled();
          expect(rows[index]?.querySelector("[data-branch-tag]")?.textContent, question).toBe(
            branch.title,
          );
        }
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
        await waitFor(() => expect(host.langyAsks).toHaveLength(1));
        const created = server.state.widgets.find(({ id }) => id === "widget-new-1")!;
        expect(created).toMatchObject({
          dashboardId: "board-1",
          name: traffic.question,
          gridRow: 3,
        });
        expect(host.langyAsks).toHaveLength(1);
        const [ask] = host.langyAsks;
        expect(ask?.question).toBeUndefined();
        expect(ask?.draft).toMatch(/^What does ".+" show over the last 30 days\?/);
        expect(ask?.context[1]?.ref).toContain(`how to answer it: ${traffic.prompt}`);
        expect(ask?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
        expect(ask?.context[0]?.ref).toContain('dashboard "Weekly review" (id board-1)');
      });
    });

    describe("when the write fails", () => {
      /** @scenario "AC12c A failed add takes the widget off again and does not seed Langy" */
      it("closes the picker, says the add failed, seeds no Langy conversation, and stores no widget", async () => {
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
        await waitFor(() =>
          expect(host.failures).toEqual([
            expect.objectContaining({ fallbackTitle: "Couldn't add the widget" }),
          ]),
        );
        expect(host.lastQuery).toEqual({ addBlock: void 0 });
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

        expect(await pickerRegions()).toEqual(ALL_WIDGETS);
        // One role query for the whole list: a named query per question timed out in CI.
        const rows = within(screen.getByRole("dialog")).getAllByRole("button");
        for (const { question } of PICKER_QUESTIONS) {
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
        expect(pickerSearch()).toHaveValue("");
        const all = chip({ row: "Categories", name: "All" });
        expect(all).toHaveAttribute("aria-pressed", "true");
        expect(all.textContent).toMatch(chipText({ name: "All", count: TOTAL }));
        expect(chip({ row: "Categories", name: "Grow" })).toBeInTheDocument();
        const types = within(screen.getByRole("group", { name: "Agent types" }));
        expect(types.getByRole("button", { name: /^Voice agent\s*\d+$/ })).toBeInTheDocument();
        expect(
          types.getByRole("button", {
            name: new RegExp(`^Coding agent\\s*${CODING_PICKER_QUESTIONS.length}$`),
          }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "I'll build it myself" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ask Langy" })).toBeInTheDocument();
        expect(dialog.textContent).not.toMatch(/\bblocks?\b/i);
      });

      /** @scenario "AC134 Picker filters: a category lists its branches as sections, the best-ranked first" */
      it("lists a picked category's branches as sections, the best-ranked first", async () => {
        const user = userEvent.setup();
        openPicker();
        const protect = PICKER_QUESTIONS.filter(({ trunk }) => trunk === "Protect");

        await screen.findByRole("dialog");
        await user.click(chip({ row: "Categories", name: "Protect" }));

        expect(await pickerRegions()).toEqual(
          pickerSections({ questions: protect }).map(({ title }) => title),
        );
        const regions = within(screen.getByRole("dialog")).getAllByRole("region");
        expect(regions.every((region) => region.getAttribute("data-trunk") === "Protect")).toBe(
          true,
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
        expect(chip({ row: "Categories", name: "Protect" }).textContent).toMatch(
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
        expect(chip({ row: "Categories", name: "All" }).textContent).toMatch(
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
        expect(row(general.id)?.textContent).toBe(
          `${general.question}${general.branch.title}${general.why}`,
        );
      });
    });

    describe("given the picker opens on a Coding agents board", () => {
      /** @scenario "Finder: Add a widget offers coding-agent widgets only under the Coding agent chip" */
      it("starts on the Coding agent chip, listing its built widgets in their own order", async () => {
        const host = new StubAnalyticsHost({ flags: LANGY_ON, permissions: LANGY_MEMBER });
        renderDashboards({
          element: (
            <BlockPickerDialog
              board={boardSubject({ board: { id: "board-1", name: "My tokens" }, widgets: [] })}
              period={{
                periodStart: Date.UTC(2026, 8, 1),
                periodEnd: Date.UTC(2026, 8, 8),
                granularitySeconds: 86_400,
              }}
              startingAgentKind="coding"
              onAddWidgets={() => Promise.resolve(true)}
              onSkip={() => void 0}
              onClose={() => void 0}
            />
          ),
          host,
        });

        await screen.findByRole("dialog");
        expect(chip({ row: "Agent types", name: AGENT_KIND_CHIP_LABELS.coding })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(rowButtons().map((row) => row.getAttribute("data-widget"))).toEqual(
          CODING_PICKER_QUESTIONS.map(({ id }) => id),
        );
      });
    });

    describe("when the member presses I'll build it myself", () => {
      /** @scenario "Finder: Add a widget's I'll build it myself hands over to the widget editor" */
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

        await user.click(await screen.findByRole("button", { name: "I'll build it myself" }));

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
        await waitFor(() => expect(host.langyAsks).toHaveLength(1));
        expect(server.state.widgets.map(({ name }) => name)).toEqual([traffic.question]);
        expect(host.langyAsks[0]?.draft).toContain(`What does "${traffic.question}" show`);
        expect(host.langyAsks[0]?.context[1]?.ref).toContain(`widget "${traffic.question}"`);
        expect(host.langyAsks[0]?.context[1]?.ref).toContain("queries (LangWatchQL):");
      });
    });

    describe("given a search and chips that match nothing", () => {
      /** @scenario "AC137 Picker filters: no match says so and offers to clear the search and filters" */
      it("says so, and clearing lists every widget again", async () => {
        const user = userEvent.setup();
        openPicker();

        await screen.findByRole("dialog");
        await user.click(chip({ row: "Categories", name: "Profit" }));
        fireEvent.change(pickerSearch(), {
          target: { value: "zzz-no-such-widget" },
        });

        expect(
          screen.getByText(
            'No widget matches. Press "I\'ll build it myself" to write your own with Langy.',
          ),
        ).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Clear search and filters" }));

        expect(await pickerRegions()).toEqual(ALL_WIDGETS);
        expect(pickerSearch()).toHaveValue("");
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
      fireEvent.change(pickerSearch(), {
        target: { value: "latency" },
      });
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      await user.click(await screen.findByRole("button", { name: "Open the picker again" }));

      await screen.findByRole("dialog");
      expect(pickerSearch()).toHaveValue("");
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

    describe("when a fixed range is refreshed", () => {
      afterEach(() => vi.useRealTimers());

      /** @scenario "AC19d A fixed range moves its end to now on each refresh" */
      it("moves every widget's window end to the refresh, keeping its length", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.UTC(2026, 8, 28, 12, 0, 30));
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const frames = recordWidgetFrames();
        try {
          openBoard({ server: boardWithTwoWidgets(), query: { range: "24h" } });
          frames.loadAll(await screen.findAllByTitle("Custom chart"));
          const before = frames.latestContexts().map(({ timeWindow }) => timeWindow);
          expect(before.map(({ end }) => end)).toEqual([
            Date.UTC(2026, 8, 28, 12, 1),
            Date.UTC(2026, 8, 28, 12, 1),
          ]);

          vi.setSystemTime(Date.UTC(2026, 8, 28, 12, 10, 5));
          await user.click(screen.getByRole("button", { name: "Period" }));
          await user.click(await screen.findByRole("menuitem", { name: "Refresh now" }));

          await waitFor(() => {
            frames.loadAll(screen.getAllByTitle("Custom chart"));
            expect(frames.latestContexts().map(({ timeWindow }) => timeWindow.end)).toEqual([
              Date.UTC(2026, 8, 28, 12, 11),
              Date.UTC(2026, 8, 28, 12, 11),
            ]);
          });
          const after = frames.latestContexts().map(({ timeWindow }) => timeWindow);
          expect(after.map(({ start, end }) => end - start)).toEqual([86_400_000, 86_400_000]);
        } finally {
          frames.restore();
        }
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

        expect(callsTo(server, "boards.update")[0]?.input).toEqual({
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
          expect(callsTo(server, "boards.update")[0]?.input).toEqual({
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
    /** @scenario "Boards: no pin or pencil by the board title" */
    it("has no pin and no rename pencil by its title", async () => {
      openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

      expect(await screen.findByRole("heading", { name: "Weekly review" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Pin dashboard|Unpin dashboard/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rename dashboard" })).toBeNull();
    });
  });

  describe("given a member who may edit in the project that owns the board", () => {
    const EDITOR = { "proj-1": ["analytics:update"] };

    describe("when they click the title, type a new name and press Enter", () => {
      /** @scenario "Boards: clicking the title renames the board" */
      it("saves the trimmed name in the owning project, says so and shows it as the title", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = inMemoryServer({ boards: OWN_BOARDS });
        const { host } = openBoard({ server, projectPermissions: EDITOR });

        const title = await screen.findByRole("heading", { name: "Weekly review" });
        await user.click(await within(title).findByRole("button", { name: "Weekly review" }));
        const field = screen.getByRole("textbox", { name: "Dashboard name" });
        expect(field).toHaveValue("Weekly review");
        await user.clear(field);
        await user.type(field, "  Launch week {Enter}");

        await waitFor(() =>
          expect(callsTo(server, "boards.update").map((call) => call.input)).toEqual([
            { projectId: "proj-1", dashboardId: "board-1", name: "Launch week" },
          ]),
        );
        expect(await screen.findByRole("heading", { name: "Launch week" })).toBeInTheDocument();
        await waitFor(() =>
          expect(host.successes.map((notice) => notice.title)).toEqual(["Dashboard renamed"]),
        );
      });
    });

    describe("when they leave the name blank or unchanged", () => {
      /** @scenario "Boards: clicking the title renames the board" */
      it("saves nothing and shows the title again", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = inMemoryServer({ boards: OWN_BOARDS });
        openBoard({ server, projectPermissions: EDITOR });

        await user.click(await screen.findByRole("button", { name: "Weekly review" }));
        await user.clear(screen.getByRole("textbox", { name: "Dashboard name" }));
        await user.keyboard("{Enter}");
        await user.click(await screen.findByRole("button", { name: "Weekly review" }));
        await user.keyboard("{Enter}");

        expect(await screen.findByRole("heading", { name: "Weekly review" })).toBeInTheDocument();
        expect(callsTo(server, "boards.update")).toEqual([]);
      });
    });

    describe("when they press Escape while renaming", () => {
      /** @scenario "Boards: Escape cancels a rename from the title" */
      it("keeps the old name and saves nothing", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = inMemoryServer({ boards: OWN_BOARDS });
        openBoard({ server, projectPermissions: EDITOR });

        await user.click(await screen.findByRole("button", { name: "Weekly review" }));
        await user.type(screen.getByRole("textbox", { name: "Dashboard name" }), " draft{Escape}");

        expect(await screen.findByRole("heading", { name: "Weekly review" })).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: "Dashboard name" })).toBeNull();
        expect(callsTo(server, "boards.update")).toEqual([]);
      });
    });
  });

  describe("given a reader who may not rename the board", () => {
    /** @scenario "Boards: a reader who may not rename sees a plain title" */
    it("shows the title as plain text without edit rights in the owning project", async () => {
      openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

      const title = await screen.findByRole("heading", { name: "Weekly review" });
      expect(within(title).queryByRole("button")).toBeNull();
    });

    /** @scenario "My dashboards made before the mark are marked by a background step" */
    it("shows an unmarked My dashboard's title as plain text, edit rights or not", async () => {
      openBoard({
        server: inMemoryServer({
          boards: [{ ...OWN_BOARDS[0]!, id: "mine", name: "My dashboard" }],
        }),
        dashboardId: "mine",
        projectPermissions: { "proj-1": ["analytics:update"] },
      });

      const title = await screen.findByRole("heading", { name: "My dashboard" });
      expect(within(title).queryByRole("button")).toBeNull();
    });
  });

  describe("given the member's own My dashboard, marked theirs", () => {
    /** @scenario "My dashboard can be renamed and stays the member's My dashboard" */
    it("renames it from its title, keeping its mark", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = inMemoryServer({
        boards: [
          { ...OWN_BOARDS[0]!, id: "mine", name: "My dashboard", myDashboardOfUserId: "user-1" },
        ],
      });
      openBoard({
        server,
        dashboardId: "mine",
        projectPermissions: { "proj-1": ["analytics:update"] },
      });

      const title = await screen.findByRole("heading", { name: "My dashboard" });
      await user.click(await within(title).findByRole("button", { name: "My dashboard" }));
      const field = screen.getByRole("textbox", { name: "Dashboard name" });
      await user.clear(field);
      await user.type(field, "Team pulse{Enter}");

      await waitFor(() =>
        expect(callsTo(server, "boards.update").map((call) => call.input)).toEqual([
          { projectId: "proj-1", dashboardId: "mine", name: "Team pulse" },
        ]),
      );
      expect(await screen.findByRole("heading", { name: "Team pulse" })).toBeInTheDocument();
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
    /** @scenario "AC107 Sidebar menu: each board offers its actions in order" */
    it("offers no Share action in the header or the sidebar menu", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = inMemoryServer({ boards: STARRED_BOARDS });
      openBoard({ server, withSidebar: true });

      await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
      await screen.findByRole("menuitem", { name: "Delete" });

      expect(screen.queryByRole("menuitem", { name: /share|default/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /visibility|share/i })).toBeNull();
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
      it("offers Edit code, the two copies, Export CSV, Duplicate and Delete, and nothing else", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        openBoard({ server: boardWithOneWidget() });

        await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));

        const items = await screen.findAllByRole("menuitem");
        expect(items.map((item) => item.textContent?.trim())).toEqual([
          "Edit code",
          "Copy widget id",
          "Copy API snippet",
          "Export CSV Still loading",
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

  describe("given a member opens a new board with '+'", () => {
    const TRAFFIC = PICKER_SECTIONS.flatMap(({ questions }) => questions).find(
      ({ id }) => id === "traffic",
    )!;
    const pickTraffic = async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(await screen.findByRole("button", { name: new RegExp(escape(TRAFFIC.question)) }));

    /** @scenario "AC162 The '+' on Your dashboards opens a new board without storing it" */
    it("shows a blank, numbered untitled board with the templates, and stores nothing", async () => {
      const server = inMemoryServer({ boards: OWN_BOARDS });
      openBoard({ server, dashboardId: "new" });

      expect(
        await screen.findByRole("heading", { name: "Untitled dashboard 1" }),
      ).toBeInTheDocument();
      expect(await screen.findByText("Or start from a template")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add a widget" })).toBeInTheDocument();
      await waitFor(() => expect(callsTo(server, "boards.getAll").length).toBeGreaterThan(0));
      expect(callsTo(server, "boards.create")).toEqual([]);
    });

    /**
     * @scenario "Boards: a template used on an empty board fills that board"
     * @scenario "AC162c A new board's first widget stores it once"
     */
    it("stores the new board once, under the template's name, holding its widgets", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const { host } = openBoard({
        server,
        dashboardId: "new",
        flags: LANGY_ON,
        permissions: LANGY_MEMBER,
      });
      const template = curatedBoardById("data")!.card.board;

      await user.click(await screen.findByRole("button", { name: `Use ${template.name}` }));

      await waitFor(() => expect(host.langyAsks).toHaveLength(1));
      expect(host.langyAsks[0]?.context[0]).toMatchObject({ label: template.name });
      expect(callsTo(server, "boards.create").map(({ input }) => input)).toEqual([
        { projectId: "proj-1", name: template.name, homeProduct: "llm-ops" },
      ]);
      expect(server.state.widgets.every(({ dashboardId }) => dashboardId === "board-new-3")).toBe(
        true,
      );
      expect(server.state.boards.find(({ id }) => id === "board-new-3")?.description).toBe(
        template.description,
      );
      expect(host.navigations).toEqual(["/test-project/dashboards/board-new-3"]);
    });

    /** @scenario "AC10 Blank board matches the reference" */
    it("offers a description and the one empty board view, stored at Project with no scope sent", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      openBoard({ server, dashboardId: "new", flags: LANGY_ON, permissions: LANGY_MEMBER });

      expect(await screen.findByText("Or start from a template")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "What do you want to know?" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Add a description" }));
      await user.type(screen.getByRole("textbox", { name: "Dashboard description" }), "Q{Enter}");

      await waitFor(() => expect(callsTo(server, "boards.create")).toHaveLength(1));
      expect(callsTo(server, "boards.create")[0]?.input).toEqual({
        projectId: "proj-1",
        name: "Untitled dashboard 1",
        homeProduct: "llm-ops",
      });
    });

    /** @scenario "AC162b Leaving a new board unedited stores nothing" */
    it("stores nothing when the member leaves without an edit", async () => {
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const { view } = openBoard({ server, dashboardId: "new", query: { addBlock: "open" } });
      await screen.findByRole("dialog");

      view.unmount();

      expect(callsTo(server, "boards.create")).toEqual([]);
      expect(server.state.boards).toHaveLength(OWN_BOARDS.length);
    });

    /** @scenario "AC162c A new board's first widget stores it once" */
    it("stores the board once with the picked widget on it, and moves the address to it", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const { host } = openBoard({ server, dashboardId: "new", query: { addBlock: "open" } });

      await pickTraffic(user);

      await waitFor(() => expect(callsTo(server, "dashboardWidgets.create")).toHaveLength(1));
      expect(callsTo(server, "boards.create").map(({ input }) => input)).toEqual([
        { projectId: "proj-1", name: "Untitled dashboard 1", homeProduct: "llm-ops" },
      ]);
      expect(server.state.widgets.map(({ dashboardId }) => dashboardId)).toEqual(["board-new-3"]);
      expect(host.replacements).toEqual(["/test-project/dashboards/board-new-3"]);
    });

    /** @scenario "AC162l A question asked from a new board's ask bar only goes to Langy" */
    it("asks Langy a question typed in Add a widget, and leaves Add a widget closed", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const { host } = openBoard({
        server,
        dashboardId: "new",
        query: { addBlock: "open" },
        flags: LANGY_ON,
        permissions: LANGY_MEMBER,
      });
      await screen.findByRole("dialog");

      await user.type(pickerSearch(), "zzz why are my users unhappy{Enter}");

      await waitFor(() => expect(host.langyAsks).toHaveLength(1));
      expect(host.langyAsks[0]).toMatchObject({
        question: "zzz why are my users unhappy",
        askedFrom: "dashboard:board-new-3",
      });
      expect(callsTo(server, "boards.create")).toHaveLength(1);
      expect(host.replacements).toEqual(["/test-project/dashboards/board-new-3"]);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    /** @scenario "AC162d Renaming, describing or pinning a new board stores it with that edit" */
    it("stores the board with the description the member typed", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      openBoard({ server, dashboardId: "new" });

      await user.click(await screen.findByRole("button", { name: "Add a description" }));
      await user.type(
        screen.getByRole("textbox", { name: "Dashboard description" }),
        "Refund questions{Enter}",
      );

      await waitFor(() => expect(callsTo(server, "boards.update")).toHaveLength(1));
      expect(callsTo(server, "boards.create")).toHaveLength(1);
      expect(server.state.boards.at(-1)).toMatchObject({
        id: "board-new-3",
        description: "Refund questions",
      });
    });

    /** @scenario "AC162f A refused store keeps the new board open" */
    it("says why, keeps the board unsaved, and stores it on the next edit", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS, refuseBoardCreates: 1 });
      const { host } = openBoard({ server, dashboardId: "new", query: { addBlock: "open" } });

      await pickTraffic(user);

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(callsTo(server, "dashboardWidgets.create")).toEqual([]);
      expect(host.replacements).toEqual([]);
      expect(screen.getByRole("heading", { name: "Untitled dashboard 1" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Add a description" }));
      await user.type(
        screen.getByRole("textbox", { name: "Dashboard description" }),
        "Refunds{Enter}",
      );

      await waitFor(() => expect(callsTo(server, "boards.update")).toHaveLength(1));
      expect(callsTo(server, "boards.create")).toHaveLength(2);
      expect(server.state.boards.at(-1)).toMatchObject({
        id: "board-new-3",
        description: "Refunds",
      });
    });

    /** @scenario "AC162d Renaming, describing or pinning a new board stores it with that edit" */
    it("keeps the board it stored when the description is refused, and stores no second one", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS, refuseBoardUpdates: 1 });
      const { host } = openBoard({ server, dashboardId: "new" });

      await user.click(await screen.findByRole("button", { name: "Add a description" }));
      await user.type(screen.getByRole("textbox", { name: "Dashboard description" }), "Q{Enter}");
      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(readHandledError(host.failures[0]?.error)?.code).toBe("dashboard_not_found");
      expect(host.replacements).toEqual(["/test-project/dashboards/board-new-3"]);

      await user.click(screen.getByRole("button", { name: "Q" }));
      await user.type(screen.getByRole("textbox", { name: "Dashboard description" }), "R{Enter}");

      await waitFor(() => expect(callsTo(server, "boards.update")).toHaveLength(2));
      expect(callsTo(server, "boards.create")).toHaveLength(1);
      expect(server.state.boards.at(-1)).toMatchObject({ id: "board-new-3", description: "QR" });
    });

    /** @scenario "AC162f A refused store keeps the new board open" */
    it("sends the same description again when the member confirms it after a refusal", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS, refuseBoardCreates: 1 });
      const { host } = openBoard({ server, dashboardId: "new" });

      await user.click(await screen.findByRole("button", { name: "Add a description" }));
      await user.type(
        screen.getByRole("textbox", { name: "Dashboard description" }),
        "Refunds{Enter}",
      );
      await waitFor(() => expect(host.failures).toHaveLength(1));

      await user.click(screen.getByRole("button", { name: "Refunds" }));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(callsTo(server, "boards.create")).toHaveLength(2));
      await waitFor(() =>
        expect(server.state.boards.at(-1)).toMatchObject({
          id: "board-new-3",
          description: "Refunds",
        }),
      );
    });

    /** @scenario "AC162f A refused store keeps the new board open" */
    it("stores the board with no description when the member cleared it after a refusal", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS, refuseBoardCreates: 1 });
      const { host } = openBoard({ server, dashboardId: "new" });

      await user.click(await screen.findByRole("button", { name: "Add a description" }));
      await user.type(
        screen.getByRole("textbox", { name: "Dashboard description" }),
        "Refunds{Enter}",
      );
      await waitFor(() => expect(host.failures).toHaveLength(1));

      await user.click(screen.getByRole("button", { name: "Refunds" }));
      await user.clear(screen.getByRole("textbox", { name: "Dashboard description" }));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(callsTo(server, "boards.create")).toHaveLength(2));
      await waitFor(() => expect(host.replacements).toHaveLength(1));
      expect(callsTo(server, "boards.update")).toEqual([]);
      expect(server.state.boards.at(-1)).toMatchObject({ id: "board-new-3", description: null });
    });

    /** @scenario "AC162c A new board's first widget stores it once" */
    it("adds one widget when Save is pressed again while the board is being stored", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = inMemoryServer({ boards: OWN_BOARDS, holdBoardCreates: true });
      openBoard({ server, dashboardId: "new", query: { editWidget: "new" } });
      const drawer = await screen.findByRole("dialog");

      await user.click(within(drawer).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(callsTo(server, "boards.create")).toHaveLength(1));
      fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
      server.releaseBoardCreates();

      await waitFor(() => expect(callsTo(server, "dashboardWidgets.updateLayout")).toHaveLength(1));
      expect(callsTo(server, "dashboardWidgets.create")).toHaveLength(1);
      expect(callsTo(server, "boards.create")).toHaveLength(1);
    });

    /** @scenario "AC162j Edits made while a new board is being stored land on it in the order made" */
    it("keeps the description given while the first widget's save stores the board", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = inMemoryServer({ boards: OWN_BOARDS, holdBoardCreates: true });
      openBoard({ server, dashboardId: "new", query: { editWidget: "new" } });
      const drawer = await screen.findByRole("dialog");

      await user.click(within(drawer).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(callsTo(server, "boards.create")).toHaveLength(1));
      const redescribe = (button: string, text: string) => {
        fireEvent.click(screen.getByRole("button", { name: button, hidden: true }));
        const field = screen.getByRole("textbox", { name: "Dashboard description", hidden: true });
        fireEvent.change(field, { target: { value: text } });
        fireEvent.keyDown(field, { key: "Enter" });
      };
      redescribe("Add a description", "Refunds");
      redescribe("Refunds", "Returns");
      server.releaseBoardCreates();

      await waitFor(() => expect(callsTo(server, "dashboardWidgets.create")).toHaveLength(1));
      await waitFor(() => expect(callsTo(server, "boards.update")).toHaveLength(2));
      expect(callsTo(server, "boards.update").map(({ input }) => input)).toEqual([
        expect.objectContaining({ description: "Refunds" }),
        expect.objectContaining({ description: "Returns" }),
      ]);
      expect(server.state.boards.at(-1)).toMatchObject({
        id: "board-new-3",
        description: "Returns",
      });
      expect(callsTo(server, "boards.create")).toHaveLength(1);
    });

    /** @scenario "AC162j Edits made while a new board is being stored land on it in the order made" */
    it("lets a rename made once the board is stored wait for the edits queued before it", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS, holdBoardCreates: true });
      const { host } = openBoard({ server, dashboardId: "new" });
      await user.click(await screen.findByRole("button", { name: "Add a description" }));
      await user.type(screen.getByRole("textbox", { name: "Dashboard description" }), "Q{Enter}");
      await waitFor(() => expect(callsTo(server, "boards.create")).toHaveLength(1));
      await user.click(screen.getByRole("button", { name: "Q" }));
      await user.type(screen.getByRole("textbox", { name: "Dashboard description" }), "R{Enter}");

      server.releaseBoardCreates();
      await waitFor(() => expect(host.replacements).toHaveLength(1));
      await afterDraftWrites("board-new-3");

      expect(callsTo(server, "boards.update").map(({ input }) => input)).toEqual([
        expect.objectContaining({ description: "Q" }),
        expect.objectContaining({ description: "QR" }),
      ]);
    });

    /** @scenario "AC162f A refused store keeps the new board open" */
    it("keeps the screen it opened when the first edit of a freshly loaded new board is refused", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS, refuseBoardCreates: 1 });
      const host = new StubAnalyticsHost({
        flags: FLAG_ON,
        project: { id: "proj-fresh", slug: "fresh", name: "Fresh", hasFirstMessage: true },
        route: { params: { dashboardId: "new" }, query: {} },
      });
      renderDashboards({ element: <DashboardBoardScreen />, host, answer: server.answer });
      const title = await screen.findByRole("heading", { name: "Untitled dashboard 1" });

      await user.click(screen.getByRole("button", { name: "Add a description" }));
      await user.type(screen.getByRole("textbox", { name: "Dashboard description" }), "Q{Enter}");
      await waitFor(() => expect(host.failures).toHaveLength(1));

      expect(screen.getByRole("heading", { name: "Untitled dashboard 1" })).toBe(title);
    });

    /** @scenario "AC162g Opening the new board's address again starts a new unsaved board" */
    it("leaves a new board opened while the last one was being stored unsaved, where it is", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS, holdBoardCreates: true });
      const { host } = openBoard({ server, dashboardId: "new", withSidebar: true });
      await user.click(await screen.findByRole("button", { name: "Add a description" }));
      await user.type(screen.getByRole("textbox", { name: "Dashboard description" }), "Q{Enter}");
      await waitFor(() => expect(callsTo(server, "boards.create")).toHaveLength(1));

      await user.click(screen.getByRole("button", { name: "New dashboard" }));
      server.releaseBoardCreates();

      await waitFor(() => expect(callsTo(server, "boards.update")).toHaveLength(1));
      // The stored board is listed once the lists are read again, the new draft still open.
      await waitFor(() =>
        expect(screen.getAllByRole("link").map((row) => row.getAttribute("href"))).toContain(
          "/test-project/dashboards/board-new-3",
        ),
      );
      expect(host.replacements).toEqual([]);
      expect(screen.getByRole("button", { name: "Add a description" })).toBeInTheDocument();
      const open = screen
        .getAllByRole("link")
        .filter((row) => row.getAttribute("aria-current") === "page");
      expect(open.map((row) => row.getAttribute("href"))).toEqual(["/test-project/dashboards/new"]);
      expect(callsTo(server, "boards.create")).toHaveLength(1);
    });

    /** @scenario "Undo: Undo puts the board back as it was, on the server" */
    it("undoes a widget added to a new board on that board, after another new board opened", async () => {
      // Toasts the earlier tests offered stay queued in the one toaster; start from none.
      toaster.remove();
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const host = new StubAnalyticsHost({
        flags: FLAG_ON,
        route: { params: { dashboardId: "new" }, query: { editWidget: "new" } },
      });
      renderDashboards({
        element: (
          <>
            <SavedDashboardsSection openPath="new" />
            <DashboardBoardScreen />
            <Toaster />
          </>
        ),
        host,
        answer: server.answer,
      });
      const drawer = await screen.findByRole("dialog");
      await user.click(within(drawer).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(callsTo(server, "dashboardWidgets.updateLayout")).toHaveLength(1));

      fireEvent.click(screen.getByRole("button", { name: "New dashboard", hidden: true }));
      fireEvent.click(await screen.findByRole("button", { name: "Undo", hidden: true }));

      await waitFor(() => expect(callsTo(server, "dashboardWidgets.delete")).toHaveLength(1));
      expect(server.state.widgets).toEqual([]);
      expect(callsTo(server, "boards.create")).toHaveLength(1);
      toaster.remove();
    });

    /** @scenario "AC162e Asking Langy on a new board stores it first" */
    it("stores the board before the widget editor's Langy ask, which names the stored board", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const { host } = openBoard({
        server,
        dashboardId: "new",
        query: { addBlock: "open" },
        flags: LANGY_ON,
        permissions: LANGY_MEMBER,
      });

      await user.click(await screen.findByRole("button", { name: "I'll build it myself" }));

      await waitFor(() => expect(host.langyAsks).toHaveLength(1));
      expect(callsTo(server, "boards.create")).toHaveLength(1);
      const refs = host.langyAsks[0]?.context.map(({ ref }) => ref).join(" ");
      expect(refs).toContain("(id board-new-3)");
      expect(refs).not.toContain("(id new)");
    });

    /** @scenario "AC162g Opening the new board's address again starts a new unsaved board" */
    it("opens a new unsaved board after the last one was stored, and leaves that one alone", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ boards: OWN_BOARDS });
      const first = openBoard({ server, dashboardId: "new", query: { addBlock: "open" } });
      await pickTraffic(user);
      await waitFor(() => expect(callsTo(server, "dashboardWidgets.create")).toHaveLength(1));
      first.view.unmount();

      openBoard({ server, dashboardId: "new", query: { addBlock: "open" } });
      expect(
        await screen.findByRole("heading", { name: "Untitled dashboard 2" }),
      ).toBeInTheDocument();
      await pickTraffic(user);

      await waitFor(() => expect(callsTo(server, "dashboardWidgets.create")).toHaveLength(2));
      expect(server.state.widgets.map(({ dashboardId }) => dashboardId)).toEqual([
        "board-new-3",
        "board-new-4",
      ]);
    });
  });
});
