/**
 * @vitest-environment jsdom
 * A member's boards against an in-memory dashboards and widgets server: the
 * header, the blank board and its way to the templates library, the picker
 * (questions for Langy), the period and the widget menu.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import type { DashboardVisibility } from "@langwatch/dashboard-contract";
import { explainAnyError } from "@langwatch/handled-error/presentation";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { AGENT_KIND_LABELS, PICKER_QUESTIONS, PICKER_SECTIONS } from "../catalogue/index.ts";
import { boardSubject } from "../langy/model/board-langy.ts";
import { BOARD_VISIBILITY_LOCKED_REASON } from "../model/board-visibility.ts";
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
  visibility: DashboardVisibility;
  createdById: string | null;
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

/** A picker row's add button, as opposed to the labels beside it and their "+N" fold. */
const isRowName = (name: string) => !name.startsWith("Filter by ") && !name.startsWith("Show ");

const TOTAL = PICKER_QUESTIONS.length;

/** One trunk toggle, by its words; its name ends with its count. */
const trunkChip = (name: string) =>
  within(screen.getByRole("group", { name: "Filter by trunk" })).getByRole("button", {
    name: new RegExp(`^${escape(name)}\\s*\\d+$`),
  });

/** The "Agent kind" or "Status" menu's trigger; it toggles the menu open and shut. */
const menuTrigger = (menu: string) =>
  screen.getByRole("button", { name: new RegExp(`^${escape(menu)}`) });

/** One option of the open filter menu, by its words; its name ends with its count. */
const menuOption = (name: string) =>
  screen.findByRole("menuitemcheckbox", { name: new RegExp(`^${escape(name)}\\s*\\d+$`) });

/** A filter's whole text: its words, then its count. */
const chipText = ({ name, count }: { name: string; count: number }) =>
  new RegExp(`^${escape(name)}\\s*${count}$`);

/** Every picker row's add button, across the sections. */
const rowButtons = () =>
  within(screen.getByRole("dialog"))
    .getAllByRole("region")
    .flatMap((region) => within(region).getAllByRole("button", { name: isRowName }));

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

describe("a member's board", () => {
  describe("given a member opens a board with nothing on it", () => {
    /** @scenario 'AC1 The empty board has no "Add a block" box' */
    /** @scenario "AC10 Blank board matches the reference" */
    it("shows the Ask bar and one button to the templates library, and no template cards", async () => {
      openBoard({
        server: inMemoryServer({ boards: OWN_BOARDS }),
        flags: LANGY_ON,
        permissions: LANGY_MEMBER,
      });

      expect(await screen.findByText("Add a description")).toBeInTheDocument();
      expect(await screen.findByText("This board is empty")).toBeInTheDocument();
      expect(screen.getByText("What would you like to know?")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Start from a template" })).toHaveAttribute(
        "href",
        "/test-project/dashboards/templates",
      );
      expect(screen.queryByRole("button", { name: /^Create a board from / })).toBeNull();
      expect(screen.queryByText(/^Coming soon/)).toBeNull();
      expect(screen.queryByRole("button", { name: /Add a block/ })).toBeNull();
    });

    describe("when the member presses Start from a template", () => {
      /** @scenario 'AC1 The empty board has no "Add a block" box' */
      it("opens the templates library", async () => {
        const user = userEvent.setup();
        const { host } = openBoard({ server: inMemoryServer({ boards: OWN_BOARDS }) });

        await user.click(await screen.findByRole("link", { name: "Start from a template" }));

        expect(host.navigations).toEqual(["/test-project/dashboards/templates"]);
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
      it("lists every question in its own section, and no Blocks section", async () => {
        openPicker();

        const dialog = await screen.findByRole("dialog");
        for (const section of PICKER_SECTIONS) {
          const listed = within(within(dialog).getByRole("region", { name: section.title }));
          expect(listed.getAllByRole("button", { name: isRowName })).toHaveLength(
            section.questions.length,
          );
          for (const { question, status } of section.questions) {
            const row = listed.getByRole("button", { name: new RegExp(escape(question)) });
            expect(row.matches(":disabled"), question).toBe(status === "coming-soon");
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
        for (const { question, status } of PICKER_SECTIONS.flatMap(({ questions }) => questions)) {
          const row = screen.getByRole("button", { name: new RegExp(escape(question)) });
          expect(row.matches(":disabled"), question).toBe(status === "coming-soon");
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
      /** @scenario "AC130 Picker filters: the picker offers the library's chips under the search" */
      it("offers the trunks on All and the two menus on one sideways-scrolling line, above the footer", async () => {
        const user = userEvent.setup();
        openPicker();

        await screen.findByRole("dialog");
        const all = trunkChip("All");
        expect(all).toHaveAttribute("aria-pressed", "true");
        expect(all).toHaveTextContent(chipText({ name: "All", count: TOTAL }));
        expect(trunkChip("Growth")).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "Filters" })).toHaveStyle({ overflowX: "auto" });
        await user.click(menuTrigger("Status"));
        expect(await menuOption("Coming soon")).toHaveAttribute("aria-checked", "false");
        expect(menuTrigger("Agent kind")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ask Langy" })).toBeInTheDocument();
      });

      /** @scenario "AC134 Picker filters: sections are branches in trunk order, coloured by trunk" */
      it("marks each branch section with its trunk, the trunks in order", async () => {
        openPicker();

        const regions = within(await screen.findByRole("dialog")).getAllByRole("region");
        expect(regions.map((region) => region.getAttribute("data-trunk"))).toEqual(
          PICKER_SECTIONS.map(({ trunk }) => trunk),
        );
      });
    });

    describe("when the member picks a trunk chip", () => {
      /** @scenario "AC131 Picker filters: chips narrow the widgets by trunk, agent kind and readiness" */
      /** @scenario "AC132 Picker filters: each chip counts the widgets it would show" */
      it("lists only that trunk's widgets and counts the other groups within it", async () => {
        const user = userEvent.setup();
        openPicker();
        const protect = PICKER_QUESTIONS.filter(({ trunk }) => trunk === "Protect");
        const ready = protect.filter(({ status }) => status === "ready");

        await screen.findByRole("dialog");
        await user.click(trunkChip("Protect"));

        expect(trunkChip("Protect")).toHaveAttribute("aria-pressed", "true");
        expect(rowButtons()).toHaveLength(protect.length);
        const regions = within(screen.getByRole("dialog")).getAllByRole("region");
        expect(regions.every((region) => region.getAttribute("data-trunk") === "Protect")).toBe(
          true,
        );
        expect(trunkChip("All")).toHaveTextContent(chipText({ name: "All", count: TOTAL }));
        await user.click(menuTrigger("Status"));
        expect(await menuOption("Ready")).toHaveTextContent(
          chipText({ name: "Ready", count: ready.length }),
        );
      });
    });

    describe("when the member clicks a row's agent kind label", () => {
      /** @scenario "AC138 Picker filters: a row's trunk or agent kind label filters the picker" */
      it("picks that agent kind, shown as a token, and keeps only widgets that suit it", async () => {
        const user = userEvent.setup();
        openPicker();
        const voice = AGENT_KIND_LABELS.voice;
        const suits = PICKER_QUESTIONS.filter(
          ({ agentKinds }) => agentKinds.length === 0 || agentKinds.includes("voice"),
        );

        const dialog = await screen.findByRole("dialog");
        const [label] = within(dialog).getAllByRole("button", { name: `Filter by ${voice}` });
        await user.click(label!);

        expect(screen.getByRole("button", { name: `Remove ${voice} filter` })).toBeInTheDocument();
        expect(rowButtons()).toHaveLength(suits.length);
        for (const each of within(dialog).getAllByRole("button", { name: `Filter by ${voice}` })) {
          expect(each).toHaveAttribute("aria-pressed", "true");
        }
      });

      /** @scenario "AC138 Picker filters: a row's trunk or agent kind label filters the picker" */
      it("toggles the trunk filter from a row's trunk label", async () => {
        const user = userEvent.setup();
        openPicker();

        const dialog = await screen.findByRole("dialog");
        const [label] = within(dialog).getAllByRole("button", { name: "Filter by Growth" });
        await user.click(label!);
        expect(trunkChip("Growth")).toHaveAttribute("aria-pressed", "true");

        const [again] = within(dialog).getAllByRole("button", { name: "Filter by Growth" });
        await user.click(again!);
        expect(trunkChip("All")).toHaveAttribute("aria-pressed", "true");
      });
    });

    describe("when the member picks a built widget from a narrowed list", () => {
      /** @scenario "AC135 Picker filters: a widget picked from a filtered list is added and drafts its Langy prompt" */
      it("closes the picker, stores the widget and drafts its prompt for Langy", async () => {
        const user = userEvent.setup();
        const { server, host } = openPicker();
        const traffic = PICKER_QUESTIONS.find(({ id }) => id === "traffic")!;

        await screen.findByRole("dialog");
        await user.click(trunkChip(traffic.trunk));
        await user.click(menuTrigger("Status"));
        await user.click(await menuOption("Ready"));
        await user.click(menuTrigger("Status"));
        await user.click(
          screen.getByRole("button", { name: new RegExp(escape(traffic.question)) }),
        );

        await waitFor(() => expect(host.lastQuery).toEqual({ addBlock: void 0 }));
        expect(server.state.widgets.map(({ name }) => name)).toEqual([traffic.question]);
        expect(host.langyAsks).toHaveLength(1);
        expect(host.langyAsks[0]?.draft?.startsWith(traffic.prompt)).toBe(true);
      });
    });

    describe("given a search and chips that match nothing", () => {
      /** @scenario "AC137 Picker filters: no match says so and offers to clear the search and filters" */
      it("says so, and clearing lists every widget again", async () => {
        const user = userEvent.setup();
        openPicker();

        await screen.findByRole("dialog");
        await user.click(trunkChip("Profit"));
        fireEvent.change(screen.getByRole("searchbox", { name: "Search questions" }), {
          target: { value: "zzz-no-such-widget" },
        });

        expect(screen.getByText("No matching questions. Ask Langy below.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Clear search and filters" }));

        expect(await pickerRegions()).toEqual(PICKER_SECTIONS.map(({ title }) => title));
        expect(screen.getByRole("searchbox", { name: "Search questions" })).toHaveValue("");
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
          onClose={() => setIsOpen(false)}
        />
      );
    }

    /** @scenario "AC136 Picker filters: the filters reset when the picker closes" */
    it("opens again with an empty search, the trunks on All, no token and nothing in the address", async () => {
      const user = userEvent.setup();
      const host = new StubAnalyticsHost({ flags: LANGY_ON, permissions: LANGY_MEMBER });
      renderDashboards({ element: <ReopenablePicker />, host });

      const dialog = await screen.findByRole("dialog");
      fireEvent.change(screen.getByRole("searchbox", { name: "Search questions" }), {
        target: { value: "latency" },
      });
      await user.click(trunkChip("Growth"));
      await user.click(menuTrigger("Agent kind"));
      await user.click(await menuOption(AGENT_KIND_LABELS.voice));
      await user.click(menuTrigger("Agent kind"));
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      await user.click(await screen.findByRole("button", { name: "Open the picker again" }));

      await screen.findByRole("dialog");
      expect(screen.getByRole("searchbox", { name: "Search questions" })).toHaveValue("");
      expect(trunkChip("All")).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByRole("button", { name: /^Remove .* filter$/ })).toBeNull();
      expect(host.lastQuery).toBeUndefined();
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

        expect(await screen.findByText("This board is empty")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Actions for Traces" })).toBeNull();
      });
    });
  });
});
