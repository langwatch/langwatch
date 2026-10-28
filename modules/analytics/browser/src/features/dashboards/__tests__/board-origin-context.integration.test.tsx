/**
 * @vitest-environment jsdom
 * The origins a widget leaves out, as the query door receives them: by default Langy's, else its
 * own "Langy traces" setting from the editor, else its board's stored list. Only the sandboxed
 * frame is stood in for, since jsdom cannot run it.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { frames } = vi.hoisted(() => ({
  frames: new WeakMap<Element, SandboxedChartFrameProps>(),
}));

vi.mock("../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: SandboxedChartFrameProps) => (
    <div
      data-testid="sandboxed-frame"
      ref={(element) => {
        if (element) frames.set(element, props);
      }}
    />
  ),
}));

import {
  AnalyticsHostProvider,
  type AnalyticsRouteReading,
} from "../../../model/analytics-host.ts";
import {
  ANALYTICS_MEMBER_PERMISSIONS,
  StubAnalyticsHost,
  type StubAnalyticsHostOptions,
} from "../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import { boardExcludedOrigins } from "../model/board-period.ts";
import { curatedBoardById } from "../model/curated-boards.ts";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const FLAGS = { release_dashboards: true, release_langy_enabled: true };
const PROJECT = {
  id: HOME_BOARD.projectId,
  slug: "test-project",
  name: "Test Project",
  hasFirstMessage: true,
};
const MEMBER = [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"];
const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
/** A stored widget's definition, which may carry its own Langy traces setting. */
const GRAPH: {
  version: 1;
  code: string;
  queries: { name: string; sql: string }[];
  excludedOrigins?: string[];
} = {
  version: 1,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql: "SELECT count() AS n FROM traces" }],
};
const WIDGET = {
  id: "w-1",
  dashboardId: BOARD.id,
  name: "Traces",
  graph: GRAPH,
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 3,
};
/** A second widget beside the first, so a change to one shows the other keeps its own. */
const OTHER_WIDGET = {
  ...WIDGET,
  id: "w-2",
  name: "Errors",
  graph: { ...WIDGET.graph, code: "export default function Errors() { return null; }" },
  gridColumn: 4,
};

/**
 * Langy's turns as the store holds them: source gateway, origin langy. A statement naming
 * them reads them unless "langy" is left out, as the server's origin scope does; others read none.
 */
const LANGY_TURN_SQL =
  "SELECT toStartOfDay(OccurredAt) AS day, count() AS n FROM traces " +
  "WHERE TraceName = 'langy.turn' GROUP BY day";
const LANGY_TURN_ROWS = [
  { day: "2026-10-20", n: 2 },
  { day: "2026-10-21", n: 9 },
];
function langyTurnRows(input: { sql: string; excludeOrigins?: readonly string[] }) {
  const hidden = input.excludeOrigins?.includes("langy") === true;
  return input.sql === LANGY_TURN_SQL && !hidden ? LANGY_TURN_ROWS : [];
}

/**
 * One stored board with its widgets, and a query door that answers no rows; calls are kept.
 * `dashboardWidgets.update` stores the widget it is sent, as the server does.
 */
function boardServer({
  excludedOrigins = null,
  widgets = [WIDGET],
}: { excludedOrigins?: string[] | null; widgets?: readonly (typeof WIDGET)[] } = {}) {
  const calls: UiProcedureCall[] = [];
  const stored = { ...BOARD, excludedOrigins };
  const storedWidgets = widgets.map((widget) => structuredClone(widget));
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    switch (call.path) {
      case "boards.getAll":
        return Promise.resolve([{ ...stored }]);
      case "boards.listStarred":
        return Promise.resolve([]);
      case "dashboardWidgets.list":
        return Promise.resolve(structuredClone(storedWidgets));
      case "dashboardWidgets.update": {
        const {
          id,
          name,
          code,
          queries,
          excludedOrigins: origins,
        } = call.input as {
          id: string;
          name?: string;
          code: string;
          queries: { name: string; sql: string }[];
          excludedOrigins?: string[];
        };
        const widget = storedWidgets.find((candidate) => candidate.id === id);
        if (widget) {
          widget.name = name ?? widget.name;
          widget.graph = {
            ...widget.graph,
            code,
            queries,
            ...(origins === undefined ? {} : { excludedOrigins: origins }),
          };
        }
        return Promise.resolve({ success: true });
      }
      case "analytics.lwql.query":
        return Promise.resolve({
          columns: [{ name: "n", type: "UInt64" }],
          rows: langyTurnRows(call.input as { sql: string; excludeOrigins?: readonly string[] }),
          statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
          diagnostics: [],
          followsTimeWindow: false,
          followsGranularity: false,
        });
      default:
        return NO_PROCEDURES(call);
    }
  };
  /** What each run sent the query door. */
  const runs = () =>
    calls.flatMap(({ path, input }) =>
      path === "analytics.lwql.query"
        ? [
            input as {
              sql: string;
              excludeOrigins?: unknown;
              granularitySeconds?: number;
              timeWindow?: { start: string; end: string };
            },
          ]
        : [],
    );
  /** What each `dashboardWidgets.update` was sent. */
  const updates = () =>
    calls.flatMap(({ path, input }) => (path === "dashboardWidgets.update" ? [input] : []));
  return { answer, runs, updates };
}

/** The host double, with an address that follows each query write as the router's does. */
class AddressedHost extends StubAnalyticsHost {
  readonly listeners = new Set<() => void>();
  private query: Readonly<Record<string, string | undefined>>;

  constructor(options: StubAnalyticsHostOptions) {
    super(options);
    this.query = options.route?.query ?? {};
  }

  override route(): AnalyticsRouteReading {
    return { params: super.route().params, query: this.query };
  }

  override setQuery(next: Readonly<Record<string, string | undefined>>): void {
    super.setQuery(next);
    this.query = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * Renders the board again whenever its address changes, under a host that is a new object
 * each time, as the router's is: a compiled screen reads the address again only for a new host.
 */
function AddressedBoard({ host }: { host: AddressedHost }) {
  const [atAddress, setAtAddress] = useState(host);
  useEffect(() => {
    const readdress = () => setAtAddress(new Proxy(host, {}));
    host.listeners.add(readdress);
    return () => void host.listeners.delete(readdress);
  }, [host]);
  return (
    <AnalyticsHostProvider value={atAddress}>
      <DashboardBoardScreen />
    </AnalyticsHostProvider>
  );
}

/** Runs one of a frame's queries, as LW.useChartQuery in the widget's code does on load. */
async function frameRuns({ frame, queryName }: { frame: Element; queryName: string }) {
  const props = frames.get(frame);
  if (!props) throw new Error("the frame never rendered");
  let answer: Awaited<ReturnType<SandboxedChartFrameProps["executeQuery"]>> | undefined;
  await act(async () => {
    answer = await props.executeQuery({
      queryName,
      params: {},
      signal: new AbortController().signal,
    });
  });
  return answer;
}

afterEach(cleanup);

/** The card's frame of the widget drawing `code`, outside the editor. */
function cardFrame(code: string): Element {
  const frame = screen
    .getAllByTestId("sandboxed-frame")
    .find(
      (candidate) => frames.get(candidate)?.code === code && !candidate.closest("[role=dialog]"),
    );
  if (!frame) throw new Error("the card's frame did not render");
  return frame;
}

/** Opens the editor on the Traces widget, on its Queries tab; answers the drawer. */
async function openEditor(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit code" }));
  await screen.findByRole("tab", { name: "API / MCP" });
  const drawer = screen
    .getAllByRole("dialog")
    .find((dialog) => within(dialog).queryByRole("tab", { name: "API / MCP" }));
  if (!drawer) throw new Error("the editor did not open");
  await user.click(within(drawer).getByRole("tab", { name: /^Queries/ }));
  return drawer;
}

/** The Langy traces choice the editor shows as picked. */
function pickedLangyTraces(drawer: HTMLElement): string | undefined {
  const control = within(drawer).getByTestId("widget-langy-control");
  const picked = within(control)
    .getAllByRole("radio")
    .find((radio) => (radio as HTMLInputElement).checked);
  return picked?.closest("label")?.textContent ?? undefined;
}

/** Opens the stored board in the project in view, a personal one when asked. */
function openBoard({
  isPersonal = false,
  excludedOrigins = null,
  permissions = MEMBER,
  widgets,
  query = {},
}: {
  isPersonal?: boolean;
  excludedOrigins?: string[] | null;
  permissions?: readonly string[];
  widgets?: readonly (typeof WIDGET)[];
  /** The board's address, such as its range and grain. */
  query?: Readonly<Record<string, string>>;
} = {}) {
  const server = boardServer({ excludedOrigins, ...(widgets ? { widgets } : {}) });
  const host = new AddressedHost({
    flags: FLAGS,
    permissions,
    project: { ...PROJECT, isPersonal },
    route: { params: { dashboardId: BOARD.id }, query },
  });
  renderDashboards({ element: <AddressedBoard host={host} />, host, answer: server.answer });
  return { ...server, host };
}

describe("given a member opens a stored board", () => {
  describe("when a widget's card runs its query", () => {
    /** @scenario "AC193 Langy: the origins a board leaves out are a list a board parameter can set later" */
    it("names the origins the board leaves out as a list, langy by default", async () => {
      const server = openBoard();

      await frameRuns({ frame: await screen.findByTestId("sandboxed-frame"), queryName: "main" });

      expect(server.runs()).toEqual([
        expect.objectContaining({ sql: WIDGET.graph.queries[0]?.sql, excludeOrigins: ["langy"] }),
      ]);
    });
  });

  describe("when the member opens the widget's editor", () => {
    /** @scenario "AC190 Langy: every widget on a board leaves out Langy's conversations by default" */
    it("runs the preview with the origins the card leaves out", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = openBoard();
      const card = await screen.findByTestId("sandboxed-frame");

      await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit code" }));
      await screen.findByRole("tab", { name: "API / MCP" });
      const drawer = screen
        .getAllByRole("dialog")
        .find((dialog) => within(dialog).queryByRole("tab", { name: "API / MCP" }));
      if (!drawer) throw new Error("the editor did not open");
      const preview = await within(drawer).findByTestId("sandboxed-frame");
      await frameRuns({ frame: card, queryName: "main" });
      await frameRuns({ frame: preview, queryName: "main" });

      expect(preview).not.toBe(card);
      expect(server.runs().map((run) => run.excludeOrigins)).toEqual([["langy"], ["langy"]]);
    });
  });
});

describe("given a member opens a stored board in their personal project", () => {
  describe("when a widget's card runs its query", () => {
    /** @scenario "AC198 Langy: a board in a personal project shows Langy's conversations" */
    it("leaves out no origin, so the widget counts Langy's conversations too", async () => {
      const server = openBoard({ isPersonal: true });

      await frameRuns({ frame: await screen.findByTestId("sandboxed-frame"), queryName: "main" });

      expect(server.runs()).toEqual([
        expect.objectContaining({ sql: WIDGET.graph.queries[0]?.sql, excludeOrigins: [] }),
      ]);
    });
  });
});

describe("given a member opens a From LangWatch board", () => {
  /** @scenario "AC190 Langy: every widget on a board leaves out Langy's conversations by default" */
  it("runs every widget's query with Langy's origin left out", async () => {
    const server = boardServer();
    const host = new StubAnalyticsHost({
      flags: FLAGS,
      permissions: MEMBER,
      route: { params: { templateId: "release" }, query: {} },
    });
    const widgets = curatedBoardById("release")?.widgets ?? [];
    renderDashboards({ element: <CuratedBoardScreen />, host, answer: server.answer });
    await screen.findByRole("heading", { name: "Release check" });

    for (const frame of screen.getAllByTestId("sandboxed-frame")) {
      const widget = widgets.find(({ definition }) => definition.code === frames.get(frame)?.code);
      const queryName = widget?.definition.queries[0]?.name;
      if (queryName) await frameRuns({ frame, queryName });
    }

    expect(server.runs().length).toBe(widgets.length);
    expect(server.runs().length).toBeGreaterThan(0);
    expect(server.runs().map((run) => run.excludeOrigins)).toEqual(widgets.map(() => ["langy"]));
  });
});

describe("given a From LangWatch board", () => {
  /** @scenario "AC200h Langy setting: a From LangWatch board's widgets keep the board's rule" */
  it("shows no Langy traces control and leaves langy out", async () => {
    const server = boardServer();
    const host = new StubAnalyticsHost({
      flags: FLAGS,
      permissions: MEMBER,
      route: { params: { templateId: "release" }, query: {} },
    });
    renderDashboards({ element: <CuratedBoardScreen />, host, answer: server.answer });
    await screen.findByRole("heading", { name: "Release check" });
    const frame = screen.getAllByTestId("sandboxed-frame")[0]!;
    const widget = curatedBoardById("release")?.widgets.find(
      ({ definition }) => definition.code === frames.get(frame)?.code,
    );
    await frameRuns({ frame, queryName: widget?.definition.queries[0]?.name ?? "" });

    expect(screen.queryByText("Langy traces")).toBeNull();
    expect(server.runs().map((run) => run.excludeOrigins)).toEqual([
      boardExcludedOrigins({ stored: null, isPersonalProject: false }),
    ]);
  });

  /** @scenario "AC200h Langy setting: a From LangWatch board's widgets keep the board's rule" */
  it("leaves out no origin in a personal project", async () => {
    const server = boardServer();
    const host = new StubAnalyticsHost({
      flags: FLAGS,
      permissions: MEMBER,
      project: { ...PROJECT, isPersonal: true },
      route: { params: { templateId: "release" }, query: {} },
    });
    renderDashboards({ element: <CuratedBoardScreen />, host, answer: server.answer });
    await screen.findByRole("heading", { name: "Release check" });
    const frame = screen.getAllByTestId("sandboxed-frame")[0]!;
    const widget = curatedBoardById("release")?.widgets.find(
      ({ definition }) => definition.code === frames.get(frame)?.code,
    );
    await frameRuns({ frame, queryName: widget?.definition.queries[0]?.name ?? "" });

    expect(server.runs().map((run) => run.excludeOrigins)).toEqual([
      boardExcludedOrigins({ stored: null, isPersonalProject: true }),
    ]);
  });
});

describe("given a widget's Langy traces setting", () => {
  describe("when the widget stores none and its board leaves langy out", () => {
    /** @scenario "AC200 Langy setting: the widget editor shows the setting a widget runs with" */
    it("shows Left out beside the queries, with a hint, and leaves langy out", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = openBoard({ excludedOrigins: ["langy"] });
      const card = await screen.findByTestId("sandboxed-frame");
      await frameRuns({ frame: card, queryName: "main" });

      const drawer = await openEditor(user);
      await frameRuns({
        frame: await within(drawer).findByTestId("sandboxed-frame"),
        queryName: "main",
      });

      expect(pickedLangyTraces(drawer)).toBe("Left out");
      expect(within(drawer).getByText("This widget counts your agent's traces only.")).toBeTruthy();
      expect(screen.queryAllByText("Langy traces")).toHaveLength(1);
      expect(server.runs().map((run) => run.excludeOrigins)).toEqual([["langy"], ["langy"]]);
    });
  });

  describe("when a member picks Included and saves", () => {
    /** @scenario "AC200b Langy setting: a widget saved as Included runs with no origin left out" */
    it("stores the empty list on that widget and runs its card with Langy counted", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = openBoard({ excludedOrigins: ["langy"], widgets: [WIDGET, OTHER_WIDGET] });
      await screen.findAllByTestId("sandboxed-frame");

      const drawer = await openEditor(user);
      await user.click(within(drawer).getByRole("radio", { name: "Included" }));
      await user.click(within(drawer).getByRole("button", { name: "Save" }));
      await vi.waitFor(() => expect(screen.queryByRole("tab", { name: "API / MCP" })).toBeNull());
      await vi.waitFor(() => expect(screen.getAllByTestId("sandboxed-frame")).toHaveLength(2));
      await frameRuns({ frame: cardFrame(WIDGET.graph.code), queryName: "main" });
      await frameRuns({ frame: cardFrame(OTHER_WIDGET.graph.code), queryName: "main" });

      expect(server.updates()).toEqual([
        expect.objectContaining({ id: WIDGET.id, excludedOrigins: [] }),
      ]);
      expect(server.runs().map((run) => run.excludeOrigins)).toEqual([[], ["langy"]]);
    });
  });

  describe("when a member picks Included in the editor", () => {
    /** @scenario "AC200g Langy setting: changing it runs the preview again" */
    it("runs the preview again with no origin left out, and Cancel stores nothing", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = openBoard({ excludedOrigins: ["langy"] });
      await screen.findByTestId("sandboxed-frame");
      const drawer = await openEditor(user);
      const before = await within(drawer).findByTestId("sandboxed-frame");
      await frameRuns({ frame: before, queryName: "main" });

      await user.click(within(drawer).getByRole("radio", { name: "Included" }));
      const after = within(drawer).getByTestId("sandboxed-frame");
      await frameRuns({ frame: after, queryName: "main" });
      const picked = pickedLangyTraces(drawer);
      await user.click(within(drawer).getByTestId("analytics-widget-cancel"));
      await vi.waitFor(() => expect(screen.queryByRole("tab", { name: "API / MCP" })).toBeNull());
      await frameRuns({ frame: cardFrame(WIDGET.graph.code), queryName: "main" });

      expect(after).not.toBe(before);
      expect(picked).toBe("Included");
      expect(server.runs().map((run) => run.excludeOrigins)).toEqual([["langy"], [], ["langy"]]);
      expect(server.updates()).toEqual([]);
    });
  });

  describe("when the board was set to include Langy before widgets carried the setting", () => {
    /** @scenario "AC200f Langy setting: a widget that stores none follows its board's stored setting, else the default" */
    it("runs the card with no origin left out and shows Included in the editor", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = openBoard({ excludedOrigins: [] });
      await frameRuns({ frame: await screen.findByTestId("sandboxed-frame"), queryName: "main" });

      const drawer = await openEditor(user);

      expect(server.runs().map((run) => run.excludeOrigins)).toEqual([[]]);
      expect(pickedLangyTraces(drawer)).toBe("Included");
    });
  });

  describe("when a member who may not edit the board opens it", () => {
    /** @scenario "AC200d Langy setting: only a member who can edit the board sees the setting" */
    it("shows no Langy traces control and no way into the editor", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      openBoard({ permissions: MEMBER.filter((grant) => grant !== "analytics:update") });
      await screen.findByTestId("sandboxed-frame");

      await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));
      await screen.findByRole("menuitem", { name: "Copy widget id" });

      expect(screen.queryByText("Langy traces")).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Edit code" })).toBeNull();
    });
  });
});

const LANGY_TURN_WIDGET = {
  ...WIDGET,
  name: "Langy requests",
  graph: { ...GRAPH, queries: [{ name: "turns", sql: LANGY_TURN_SQL }] },
};
const INCLUDED_LANGY_TURN_WIDGET = {
  ...LANGY_TURN_WIDGET,
  graph: { ...LANGY_TURN_WIDGET.graph, excludedOrigins: [] },
};

/** Runs the card's "turns" query, as LW.useChartQuery does on load. */
async function runTurns() {
  return frameRuns({ frame: await screen.findByTestId("sandboxed-frame"), queryName: "turns" });
}

describe("given a widget counting Langy's turns, stored from the gateway with origin langy", () => {
  describe("when the widget is set to Included", () => {
    /** @scenario "AC201 Widget data: a widget set to Included reads Langy's turns, the gateway-stored ones included" */
    it("leaves no origin out and returns the turns through LW.useChartQuery", async () => {
      const server = openBoard({ widgets: [INCLUDED_LANGY_TURN_WIDGET] });

      const answer = await runTurns();

      expect(server.runs()).toEqual([
        expect.objectContaining({ sql: LANGY_TURN_SQL, excludeOrigins: [] }),
      ]);
      expect(answer?.rows).toEqual(LANGY_TURN_ROWS);
    });
  });

  describe("when the widget and its board store no setting", () => {
    /** @scenario "AC201b Widget data: a widget left at the default leaves Langy's turns out" */
    it("names langy on the run and reads none of the turns", async () => {
      const server = openBoard({ widgets: [LANGY_TURN_WIDGET] });

      const answer = await runTurns();

      expect(server.runs().map((run) => run.excludeOrigins)).toEqual([["langy"]]);
      expect(answer?.rows).toEqual([]);
    });
  });

  describe("when the board stores that it leaves no origin out", () => {
    /** @scenario "AC201e Widget data: a board's explicit setting applies to widgets with no own value" */
    it("runs the widget with no origin left out and shows the turns", async () => {
      const server = openBoard({ excludedOrigins: [], widgets: [LANGY_TURN_WIDGET] });

      const answer = await runTurns();

      expect(server.runs().map((run) => run.excludeOrigins)).toEqual([[]]);
      expect(answer?.rows).toEqual(LANGY_TURN_ROWS);
    });
  });
});

describe("given a board set to the last 30 days at one bucket per day", () => {
  /** @scenario "AC201c Widget data: every run is bound to the period and grain the board shows" */
  it("runs the card and the preview over that period and grain, as the frame's context says", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = openBoard({ query: { range: "30d", grain: "1d" } });
    const card = await screen.findByTestId("sandboxed-frame");
    await frameRuns({ frame: card, queryName: "main" });
    const drawer = await openEditor(user);
    const preview = await within(drawer).findByTestId("sandboxed-frame");
    await frameRuns({ frame: preview, queryName: "main" });

    const bound = server.runs().map(({ timeWindow, granularitySeconds }) => ({
      start: Date.parse(timeWindow?.start ?? ""),
      end: Date.parse(timeWindow?.end ?? ""),
      granularitySeconds,
    }));
    const contexts = [card, preview].map((frame) => {
      const context = frames.get(frame)?.dashboardContext;
      return {
        start: context?.timeWindow.start,
        end: context?.timeWindow.end,
        granularitySeconds: context?.granularitySeconds,
      };
    });

    expect(bound).toHaveLength(2);
    expect(bound.every(({ granularitySeconds }) => granularitySeconds === 86_400)).toBe(true);
    expect(bound.every(({ start, end }) => end - start === 30 * 86_400_000)).toBe(true);
    expect(contexts).toEqual(bound);
  });
});
