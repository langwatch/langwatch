/**
 * @vitest-environment jsdom
 * A board where two or more widgets ended on a resource limit says so once, above the grid.
 * Only the sandboxed frame is stood in for; the failure travels the real executor and frame.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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

import { lwqlResult } from "../../../__tests__/lwql-fixtures.ts";
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
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Agent health",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};

type StoredQuery = { name: string; sql: string; sources?: string[] };

/** A stored widget; one that reads sources lets the editor empty its list. */
const widget = ({
  id,
  name,
  gridRow,
  readsSources = false,
}: {
  id: string;
  name: string;
  gridRow: number;
  readsSources?: boolean;
}) => {
  const from = readsSources
    ? "trace_metrics WHERE Source IN {dashboard_context_sources:Array(String)}"
    : "traces";
  const queries: StoredQuery[] = [
    { name: "main", sql: `SELECT count() AS n FROM ${from} -- ${id}` },
  ];
  return {
    id,
    dashboardId: BOARD.id,
    name,
    graph: { version: 1, code: "export default function Widget() { return null; }", queries },
    gridColumn: 0,
    gridRow,
    colSpan: 4,
    rowSpan: 3,
  };
};
type StoredWidget = ReturnType<typeof widget>;
const WIDGETS = [
  widget({ id: "w-1", name: "Volume", gridRow: 0 }),
  widget({ id: "w-2", name: "Cost per trace", gridRow: 3 }),
  widget({ id: "w-3", name: "Who uses it", gridRow: 6 }),
];

const BANNER = "limit-failed-widgets-banner";
const LIMIT_WORDS =
  "LangWatch limits the memory and time a widget's query may use. This is not a problem with your data.";
/** Each card says these only when its failure's code reached it; a lost code reads as unknown. */
const TIME_LIMIT_WORDS = "The query ran past the time a widget may take.";
const UNKNOWN_COLUMN_WORDS = "Check the column names against the dataset's columns.";

/** The status the server answers each code with. */
const HTTP_STATUS = {
  query_memory_exceeded: 422,
  query_timeout: 504,
  lwql_unknown_identifier: 400,
} as const;

/** The error code each widget id answers with; a widget not listed answers with rows. */
type Failures = Record<string, keyof typeof HTTP_STATUS>;

/**
 * `dashboardWidgets.update` stores what it is sent, as the server does; an unset list is dropped.
 */
function boardServer(failures: Failures, widgets: readonly StoredWidget[] = WIDGETS) {
  const stored = widgets.map((each) => structuredClone(each));
  return (call: UiProcedureCall): Promise<unknown> => {
    switch (call.path) {
      case "boards.getAll":
        return Promise.resolve([{ ...BOARD }]);
      case "boards.listStarred":
        return Promise.resolve([]);
      case "dashboardWidgets.list":
        return Promise.resolve(structuredClone(stored));
      case "dashboardWidgets.update": {
        const { id, code, queries } = call.input as {
          id: string;
          code: string;
          queries: { name: string; sql: string; sources?: string[] | null }[];
        };
        const row = stored.find((each) => each.id === id);
        if (row) {
          row.graph = {
            ...row.graph,
            code,
            queries: queries.map(({ name, sql, sources }) => ({
              name,
              sql,
              ...(sources ? { sources } : {}),
            })),
          };
        }
        return Promise.resolve({ success: true });
      }
      case "analytics.lwql.readableProjects":
        return Promise.resolve({ projects: [{ id: HOME_BOARD.projectId, name: "Test Project" }] });
      case "analytics.lwql.query": {
        const { sql } = call.input as { sql: string };
        const id = stored.find((each) => sql.endsWith(`-- ${each.id}`))?.id ?? "";
        const code = failures[id];
        return code
          ? Promise.reject(new UiProcedureRefusal(code, HTTP_STATUS[code]))
          : Promise.resolve(lwqlResult({ rows: [{ n: 1 }] }));
      }
      default:
        return NO_PROCEDURES(call);
    }
  };
}

/** Runs the query of every frame on screen not in `skip`, the way the widget's code would. */
async function answerFrames({ skip = [] }: { skip?: readonly HTMLElement[] } = {}) {
  for (const frame of await screen.findAllByTestId("sandboxed-frame")) {
    if (skip.includes(frame)) continue;
    const props = frames.get(frame);
    if (!props) throw new Error("a frame never rendered");
    await act(async () => {
      await props
        .executeQuery({ queryName: "main", params: {}, signal: new AbortController().signal })
        .catch(() => undefined);
    });
  }
}

async function openBoard(failures: Failures) {
  renderDashboards({
    element: (
      <>
        <SavedDashboardsSection openPath={BOARD.id} />
        <DashboardBoardScreen />
      </>
    ),
    host: new StubAnalyticsHost({
      flags: { release_dashboards: true },
      permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
      route: { params: { dashboardId: BOARD.id }, query: {} },
    }),
    answer: boardServer(failures),
  });
  await answerFrames();
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
 * The board under a new host object for each address, as the router hands one; the editor opens.
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

/** Opens the board a member can edit, and runs each card's query once. */
async function openEditableBoard({
  failures,
  widgets,
}: {
  failures: Failures;
  widgets: readonly StoredWidget[];
}) {
  const host = new AddressedHost({
    flags: { release_dashboards: true, release_langy_enabled: true },
    permissions: [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"],
    route: { params: { dashboardId: BOARD.id }, query: {} },
  });
  renderDashboards({
    element: (
      <>
        <AddressedBoard host={host} />
        <Toaster />
      </>
    ),
    host,
    answer: boardServer(failures, widgets),
  });
  await answerFrames();
}

/** Opens the editor on the named widget, on its Queries tab. */
async function openEditor({
  user,
  name,
}: {
  user: ReturnType<typeof userEvent.setup>;
  name: string;
}) {
  await user.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit code" }));
  await screen.findByRole("tab", { name: "API / MCP" });
  const drawer = screen
    .getAllByRole("dialog")
    .find((dialog) => within(dialog).queryByRole("tab", { name: "API / MCP" }));
  if (!drawer) throw new Error("the editor did not open");
  await user.click(within(drawer).getByRole("tab", { name: /^Queries/ }));
  return drawer;
}

afterEach(() => {
  cleanup();
  toaster.remove();
  vi.clearAllMocks();
});

describe("given a board of three widgets", () => {
  describe("when two end on a limit failure", () => {
    /** @scenario "Two widgets that failed on a limit are told once above the board" */
    it("says two of three hit a limit, with no action", async () => {
      await openBoard({ "w-2": "query_memory_exceeded", "w-3": "query_timeout" });

      const banner = await screen.findByTestId(BANNER);
      expect(banner).toHaveTextContent("2 of 3 widgets hit a limit");
      expect(banner).toHaveTextContent(LIMIT_WORDS);
      expect(banner.querySelector("button")).toBeNull();
    });
  });

  describe("when one ends on a limit failure", () => {
    /** @scenario "One widget that failed on a limit leaves the board without the line" */
    it("shows no warning", async () => {
      await openBoard({ "w-2": "query_timeout" });

      expect(await screen.findByText("Couldn't load")).toBeTruthy();
      expect(screen.getByText(TIME_LIMIT_WORDS)).toBeTruthy();
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe("when all three end on a limit failure", () => {
    /** @scenario "Every widget failing on a limit says all hit a limit" */
    it("says all three hit a limit", async () => {
      await openBoard({
        "w-1": "query_timeout",
        "w-2": "query_memory_exceeded",
        "w-3": "query_timeout",
      });

      const banner = await screen.findByTestId(BANNER);
      expect(banner).toHaveTextContent("All 3 widgets hit a limit");
      expect(banner).toHaveTextContent(LIMIT_WORDS);
    });
  });

  describe("when failures are not limits", () => {
    /** @scenario "Failures that are not limits are not counted" */
    it("shows no warning for two other failures or for one limit and one other", async () => {
      await openBoard({ "w-2": "lwql_unknown_identifier", "w-3": "lwql_unknown_identifier" });
      expect(await screen.findAllByText(UNKNOWN_COLUMN_WORDS)).toHaveLength(2);
      expect(screen.queryByTestId(BANNER)).toBeNull();
      cleanup();

      await openBoard({ "w-2": "query_timeout", "w-3": "lwql_unknown_identifier" });
      expect(await screen.findByText(TIME_LIMIT_WORDS)).toBeTruthy();
      expect(screen.getByText(UNKNOWN_COLUMN_WORDS)).toBeTruthy();
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe("when a limit-failed widget recovers", () => {
    /** @scenario "The warning goes when a widget recovers" */
    it("drops the warning once one of two retries and loads", async () => {
      const failures: Failures = { "w-2": "query_timeout", "w-3": "query_timeout" };
      await openBoard(failures);
      expect(await screen.findByTestId(BANNER)).toBeTruthy();

      // Retry remounts only its own frame; answering the rest would hide a Retry that did nothing.
      const before = screen.getAllByTestId("sandboxed-frame");
      delete failures["w-2"];
      fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0] as HTMLElement);
      await answerFrames({ skip: before });

      expect(
        screen.getAllByTestId("sandboxed-frame").filter((f) => !before.includes(f)),
      ).toHaveLength(1);
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe("when a limit-failed widget's sources are emptied", () => {
    /** @scenario "A widget that ended on a limit stops counting when its card leaves" */
    it("drops the line once the empty sources view replaces its card", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await openEditableBoard({
        failures: { "w-2": "query_memory_exceeded", "w-3": "query_timeout" },
        widgets: [
          widget({ id: "w-1", name: "Volume", gridRow: 0 }),
          widget({ id: "w-2", name: "Cost per trace", gridRow: 3, readsSources: true }),
          widget({ id: "w-3", name: "Who uses it", gridRow: 6 }),
        ],
      });
      expect(await screen.findByTestId(BANNER)).toHaveTextContent("2 of 3 widgets hit a limit");

      const drawer = await openEditor({ user, name: "Cost per trace" });
      await user.click(within(drawer).getByRole("button", { name: "Remove application" }));
      await user.click(within(drawer).getByRole("button", { name: "Save" }));
      await vi.waitFor(() => expect(screen.queryByRole("tab", { name: "API / MCP" })).toBeNull());

      await vi.waitFor(() => expect(screen.getByTestId("no-sources-picked")).toBeTruthy());
      expect(screen.getAllByText("Couldn't load")).toHaveLength(1);
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });
});
