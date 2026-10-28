/**
 * @vitest-environment jsdom
 * A widget query's sources, as the query door receives them and the editor and card show them:
 * what the query stores, else application. Only the sandboxed frame is stood in for, since jsdom
 * cannot run it.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200
 */

import { DEFAULT_WIDGET_SOURCES } from "@langwatch/analytics-contract";
import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
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
import { curatedBoardById } from "../model/curated-boards.ts";
import { CATALOGUE_QUERY_SOURCES } from "../templates/model/template-widget.ts";
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
type StoredQuery = { name: string; sql: string; sources?: string[] | null };
/** A stored widget's definition; its query stores no sources, as one saved before them. */
const GRAPH: { version: 1; code: string; queries: StoredQuery[] } = {
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
 * them reads them when the run's sources hold "langy", as the server's scope does.
 */
const LANGY_TURN_SQL =
  "SELECT toStartOfDay(OccurredAt) AS day, count() AS n FROM traces " +
  "WHERE TraceName = 'langy.turn' GROUP BY day";
const LANGY_TURN_ROWS = [
  { day: "2026-10-20", n: 2 },
  { day: "2026-10-21", n: 9 },
];
function langyTurnRows(input: { sql: string; sources?: readonly string[] | null }) {
  const counted = input.sources?.includes("langy") === true;
  return input.sql === LANGY_TURN_SQL && counted ? LANGY_TURN_ROWS : [];
}

/** A query as the server stores an update: absent keeps the stored list, null drops it. */
function storedQuery(sent: StoredQuery, held: readonly StoredQuery[]): StoredQuery {
  const { sources, ...query } = sent;
  const kept = sources === undefined ? held.find((h) => h.name === query.name)?.sources : sources;
  return kept === undefined || kept === null ? query : { ...query, sources: kept };
}

/**
 * One stored board with its widgets, and a query door that answers no rows; calls are kept.
 * `dashboardWidgets.update` stores the widget it is sent, as the server does.
 */
function boardServer({ widgets = [WIDGET] }: { widgets?: readonly (typeof WIDGET)[] } = {}) {
  const calls: UiProcedureCall[] = [];
  const stored = { ...BOARD };
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
        const { id, name, code, queries } = call.input as {
          id: string;
          name?: string;
          code: string;
          queries: StoredQuery[];
        };
        const widget = storedWidgets.find((candidate) => candidate.id === id);
        if (widget) {
          widget.name = name ?? widget.name;
          const held = widget.graph.queries;
          widget.graph = {
            ...widget.graph,
            code,
            queries: queries.map((query) => storedQuery(query, held)),
          };
        }
        return Promise.resolve({ success: true });
      }
      case "analytics.lwql.query":
        return Promise.resolve({
          columns: [{ name: "n", type: "UInt64" }],
          rows: langyTurnRows(call.input as { sql: string; sources?: readonly string[] | null }),
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
              sources?: unknown;
              excludeOrigins?: unknown;
              granularitySeconds?: number;
              timeWindow?: { start: string; end: string };
            },
          ]
        : [],
    );
  /** What each `dashboardWidgets.update` was sent. */
  const updates = () =>
    calls.flatMap(({ path, input }) =>
      path === "dashboardWidgets.update" ? [input as { id: string; queries: StoredQuery[] }] : [],
    );
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

afterEach(() => {
  cleanup();
  toaster.remove();
});

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

/** The sources pills the editor's first query shows, in order. */
function pickedSources(drawer: HTMLElement): string[] {
  const row = within(drawer).getByTestId("query-sources");
  return within(row)
    .queryAllByRole("button", { name: /^Remove / })
    .map((button) => button.getAttribute("aria-label")?.replace("Remove ", "") ?? "");
}

/** Adds one source through the row's "Add source" menu. */
async function addSource(
  user: ReturnType<typeof userEvent.setup>,
  drawer: HTMLElement,
  source: string,
) {
  await user.click(
    within(within(drawer).getByTestId("query-sources")).getByRole("button", { name: /Add source/ }),
  );
  await user.click(await screen.findByRole("menuitem", { name: source }));
}

/** Saves the editor and waits for it to close. */
async function save(user: ReturnType<typeof userEvent.setup>, drawer: HTMLElement) {
  await user.click(within(drawer).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(screen.queryByRole("tab", { name: "API / MCP" })).toBeNull());
}

/** Opens the stored board in the project in view, a personal one when asked. */
function openBoard({
  isPersonal = false,
  permissions = MEMBER,
  widgets,
  query = {},
}: {
  isPersonal?: boolean;
  permissions?: readonly string[];
  widgets?: readonly (typeof WIDGET)[];
  /** The board's address, such as its range and grain. */
  query?: Readonly<Record<string, string>>;
} = {}) {
  const server = boardServer(widgets ? { widgets } : {});
  const host = new AddressedHost({
    flags: FLAGS,
    permissions,
    project: { ...PROJECT, isPersonal },
    route: { params: { dashboardId: BOARD.id }, query },
  });
  renderDashboards({
    element: (
      <>
        <AddressedBoard host={host} />
        <Toaster />
      </>
    ),
    host,
    answer: server.answer,
  });
  return { ...server, host };
}

const sourcesOf = (runs: ReturnType<ReturnType<typeof boardServer>["runs"]>) =>
  runs.map((run) => run.sources);

describe("given a stored widget whose query stores no sources", () => {
  /** @scenario "AC200f Sources: a query that stores none counts application traces" */
  it("runs the card and the preview with the server's default, and the pills show that set", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = openBoard();
    await frameRuns({ frame: await screen.findByTestId("sandboxed-frame"), queryName: "main" });

    const drawer = await openEditor(user);
    await frameRuns({
      frame: await within(drawer).findByTestId("sandboxed-frame"),
      queryName: "main",
    });

    // The run asks the server for the default; the pills show that same default.
    expect(sourcesOf(server.runs())).toEqual([null, null]);
    expect(pickedSources(drawer)).toEqual([...DEFAULT_WIDGET_SOURCES]);
    expect(server.runs().every((run) => run.excludeOrigins === undefined)).toBe(true);
  });

  /** @scenario "AC200 Sources: each query shows its sources as pills, and the card names them" */
  it("shows the sources row under Parameters with a built-in badge, and the card's line", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    openBoard();
    await screen.findByTestId("sandboxed-frame");

    const footer = screen.getByTestId("widget-card-footer");
    const drawer = await openEditor(user);
    const row = within(drawer).getByTestId("query-sources");

    expect(footer.textContent).toBe("Sources: application");
    expect(within(drawer).getByText("Parameters")).toBeTruthy();
    expect(within(drawer).queryByText(/declared by you/)).toBeNull();
    expect(within(drawer).queryByText("No parameters declared yet.")).toBeNull();
    expect(within(row).getByText("built-in")).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: /Add parameter/ })).toBeTruthy();
  });

  /** @scenario "AC200f Sources: a query that stores none counts application traces" */
  it("saves another edit without writing sources onto the query", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = openBoard();
    await screen.findByTestId("sandboxed-frame");

    const drawer = await openEditor(user);
    await user.click(within(drawer).getByRole("button", { name: `Rename ${WIDGET.name}` }));
    await user.keyboard("{Control>}a{/Control}Renamed{Enter}");
    await save(user, drawer);

    expect(server.updates()[0]?.queries).toEqual([{ ...GRAPH.queries[0], sources: null }]);
  });
});

describe("given a member changes a query's sources in the editor", () => {
  /** @scenario "AC200b Sources: a query saved with picked sources counts only traces of those origins" */
  it("stores the picked list on that query and runs the card with it; the other widget keeps its own", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = openBoard({ widgets: [WIDGET, OTHER_WIDGET] });
    await screen.findAllByTestId("sandboxed-frame");

    const drawer = await openEditor(user);
    await addSource(user, drawer, "langy");
    const picked = pickedSources(drawer);
    await save(user, drawer);
    await vi.waitFor(() => expect(screen.getAllByTestId("sandboxed-frame")).toHaveLength(2));
    await frameRuns({ frame: cardFrame(WIDGET.graph.code), queryName: "main" });
    await frameRuns({ frame: cardFrame(OTHER_WIDGET.graph.code), queryName: "main" });

    expect(picked).toEqual(["application", "langy"]);
    expect(server.updates()[0]?.queries[0]?.sources).toEqual(["application", "langy"]);
    expect(sourcesOf(server.runs())).toEqual([["application", "langy"], null]);
  });

  /** @scenario "AC200g Sources: changing them runs the preview again" */
  it("runs the preview again with the new list, and Cancel stores nothing", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = openBoard();
    await screen.findByTestId("sandboxed-frame");
    const drawer = await openEditor(user);
    const before = await within(drawer).findByTestId("sandboxed-frame");
    await frameRuns({ frame: before, queryName: "main" });

    await addSource(user, drawer, "simulation");
    const after = await vi.waitFor(() => {
      const frame = within(drawer).getByTestId("sandboxed-frame");
      if (frame === before) throw new Error("the preview has not run again yet");
      return frame;
    });
    await frameRuns({ frame: after, queryName: "main" });
    await user.click(within(drawer).getByTestId("analytics-widget-cancel"));
    await vi.waitFor(() => expect(screen.queryByRole("tab", { name: "API / MCP" })).toBeNull());

    expect(sourcesOf(server.runs())).toEqual([null, ["application", "simulation"]]);
    expect(server.updates()).toEqual([]);
  });

  /** @scenario "AC200m Sources: a query with no source picked counts nothing and says so" */
  it("stores an empty list when the last pill goes, and the preview and card say no sources are picked", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = openBoard();
    await screen.findByTestId("sandboxed-frame");
    const drawer = await openEditor(user);

    await user.click(within(drawer).getByRole("button", { name: "Remove application" }));
    await vi.waitFor(() => expect(within(drawer).getByTestId("no-sources-picked")).toBeTruthy());
    const preview = within(drawer).getByTestId("widget-preview-sources").textContent;
    await save(user, drawer);

    expect(preview).toBe("No sources picked");
    expect(server.updates()[0]?.queries[0]?.sources).toEqual([]);
    await vi.waitFor(() => expect(screen.getByTestId("no-sources-picked")).toBeTruthy());
    expect(screen.getByTestId("widget-card-footer").textContent).toBe("No sources picked");
    expect(screen.queryByTestId("sandboxed-frame")).toBeNull();
  });
});

describe("given a member saves only a query's sources and presses Undo", () => {
  /** @scenario "AC200k Sources: Undo puts a query's sources back, including back to none" */
  it("clears a list the query did not store, so it counts application again", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const server = openBoard();
    await screen.findByTestId("sandboxed-frame");
    const drawer = await openEditor(user);
    await addSource(user, drawer, "langy");
    await save(user, drawer);
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));

    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(server.updates()).toHaveLength(2));

    expect(server.updates()[1]?.queries[0]?.sources).toBeNull();
    await vi.waitFor(() =>
      expect(screen.getByTestId("widget-card-footer").textContent).toBe("Sources: application"),
    );
  });

  /** @scenario "AC200k Sources: Undo puts a query's sources back, including back to none" */
  it("writes a stored list back", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const langy = { ...GRAPH.queries[0]!, sources: ["langy"] };
    const server = openBoard({ widgets: [{ ...WIDGET, graph: { ...GRAPH, queries: [langy] } }] });
    await screen.findByTestId("sandboxed-frame");
    const drawer = await openEditor(user);
    await addSource(user, drawer, "application");
    await save(user, drawer);
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));

    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(server.updates()).toHaveLength(2));

    expect(server.updates()[1]?.queries[0]?.sources).toEqual(["langy"]);
  });
});

describe("given a member who may not edit the board", () => {
  /** @scenario "AC200d Sources: only a member who can edit the board changes them" */
  it("shows the card's sources line and no way into the editor", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    openBoard({ permissions: MEMBER.filter((grant) => grant !== "analytics:update") });
    await screen.findByTestId("sandboxed-frame");

    await user.click(await screen.findByRole("button", { name: "Actions for Traces" }));
    await screen.findByRole("menuitem", { name: "Copy widget id" });

    expect(screen.getByTestId("widget-card-footer").textContent).toBe("Sources: application");
    expect(screen.queryByRole("menuitem", { name: "Edit code" })).toBeNull();
  });
});

describe("given a From LangWatch board", () => {
  /** @scenario "AC200h Sources: a From LangWatch board's widgets count every origin but Langy's" */
  it("runs every widget with the catalogue's sources, in a personal project too", async () => {
    for (const isPersonal of [false, true]) {
      const server = boardServer();
      const host = new StubAnalyticsHost({
        flags: FLAGS,
        permissions: MEMBER,
        project: { ...PROJECT, isPersonal },
        route: { params: { templateId: "release" }, query: {} },
      });
      const widgets = curatedBoardById("release")?.widgets ?? [];
      renderDashboards({ element: <CuratedBoardScreen />, host, answer: server.answer });
      await screen.findByRole("heading", { name: "Release check" });
      for (const frame of screen.getAllByTestId("sandboxed-frame")) {
        const widget = widgets.find(
          ({ definition }) => definition.code === frames.get(frame)?.code,
        );
        const queryName = widget?.definition.queries[0]?.name;
        if (queryName) await frameRuns({ frame, queryName });
      }

      expect(server.runs().length).toBeGreaterThan(0);
      expect(new Set(server.runs().map((run) => JSON.stringify(run.sources)))).toEqual(
        new Set([JSON.stringify(CATALOGUE_QUERY_SOURCES)]),
      );
      cleanup();
    }
  });
});

const LANGY_TURN_WIDGET = {
  ...WIDGET,
  name: "Langy requests",
  graph: { ...GRAPH, queries: [{ name: "turns", sql: LANGY_TURN_SQL }] },
};
const COUNTING_LANGY_TURN_WIDGET = {
  ...LANGY_TURN_WIDGET,
  graph: {
    ...LANGY_TURN_WIDGET.graph,
    queries: [{ name: "turns", sql: LANGY_TURN_SQL, sources: ["langy"] }],
  },
};

/** Runs the card's "turns" query, as LW.useChartQuery does on load. */
async function runTurns() {
  return frameRuns({ frame: await screen.findByTestId("sandboxed-frame"), queryName: "turns" });
}

describe("given a widget counting Langy's turns, stored from the gateway with origin langy", () => {
  describe("when its query's sources hold langy", () => {
    /** @scenario "AC201 Widget data: a query whose sources hold langy reads Langy's turns, the gateway-stored ones included" */
    it("sends langy and returns the turns through LW.useChartQuery", async () => {
      const server = openBoard({ widgets: [COUNTING_LANGY_TURN_WIDGET] });

      const answer = await runTurns();

      expect(server.runs()).toEqual([
        expect.objectContaining({ sql: LANGY_TURN_SQL, sources: ["langy"] }),
      ]);
      expect(answer?.rows).toEqual(LANGY_TURN_ROWS);
    });
  });

  describe("when its query stores no sources", () => {
    /** @scenario "AC201b Widget data: a query left at the default leaves Langy's turns out" */
    it("asks for the default and reads none of the turns, in a personal project too", async () => {
      const server = openBoard({ isPersonal: true, widgets: [LANGY_TURN_WIDGET] });

      const answer = await runTurns();

      expect(sourcesOf(server.runs())).toEqual([null]);
      expect(answer?.rows).toEqual([]);
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
