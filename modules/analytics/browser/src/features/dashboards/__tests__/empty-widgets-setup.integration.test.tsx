/**
 * @vitest-environment jsdom
 * A board where several widgets show no data, in a project that never received a trace, offers
 * Langy to set them up, with a draft that names them. Only the sandboxed frame is stood in for.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import type { AnalyticsHostProject } from "../../../model/analytics-host.ts";
import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import { curatedBoardById } from "../model/curated-boards.ts";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const LANGY_OFF = { release_dashboards: true };
const NEW_PROJECT: AnalyticsHostProject = {
  id: "proj-1",
  slug: "test-project",
  name: "Test Project",
  hasFirstMessage: false,
};
const PROJECT_WITH_TRACES: AnalyticsHostProject = { ...NEW_PROJECT, hasFirstMessage: true };
const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Agent health",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};

const widget = ({ id, name, gridRow }: { id: string; name: string; gridRow: number }) => ({
  id,
  dashboardId: BOARD.id,
  name,
  graph: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql: `SELECT count() AS n FROM traces -- ${id}` }],
  },
  gridColumn: 0,
  gridRow,
  colSpan: 4,
  rowSpan: 3,
});
const WIDGETS = [
  widget({ id: "w-1", name: "Volume", gridRow: 0 }),
  widget({ id: "w-2", name: "Cost per trace", gridRow: 3 }),
  widget({ id: "w-3", name: "Who uses it", gridRow: 6 }),
];

/** A stored board whose query door returns no rows for the widgets named empty. */
function boardServer({ emptyIds }: { emptyIds: readonly string[] }) {
  return (call: UiProcedureCall): Promise<unknown> => {
    switch (call.path) {
      case "boards.getAll":
        return Promise.resolve([{ ...BOARD }]);
      case "boards.listStarred":
        return Promise.resolve([]);
      case "dashboardWidgets.list":
        return Promise.resolve(WIDGETS.map((each) => structuredClone(each)));
      case "analytics.lwql.query": {
        const { sql } = call.input as { sql: string };
        const empty = emptyIds.some((id) => sql.endsWith(`-- ${id}`));
        return Promise.resolve(lwqlResult(empty ? { rows: [] } : {}));
      }
      default:
        return NO_PROCEDURES(call);
    }
  };
}

async function openBoardWithEmptyWidgets({
  emptyIds,
  flags = LANGY_ON,
  project = NEW_PROJECT,
}: {
  emptyIds: readonly string[];
  flags?: Record<string, boolean>;
  project?: AnalyticsHostProject;
}) {
  const host = new StubAnalyticsHost({
    flags,
    project,
    permissions: [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"],
    route: { params: { dashboardId: BOARD.id }, query: {} },
  });
  renderDashboards({
    element: (
      <>
        <SavedDashboardsSection openPath={BOARD.id} />
        <DashboardBoardScreen />
      </>
    ),
    host,
    answer: boardServer({ emptyIds }),
  });
  for (const frame of await screen.findAllByTestId("sandboxed-frame")) {
    const props = frames.get(frame);
    if (!props) throw new Error("a frame never rendered");
    await act(async () => {
      await props
        .executeQuery({ queryName: "main", params: {}, signal: new AbortController().signal })
        .catch(() => undefined);
    });
  }
  return host;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a board with Langy where two widgets show no data", () => {
  /** @scenario "AC13d Several empty widgets offer to ask Langy to set them up" */
  it("says how many are empty and drafts a setup prompt naming them, unsent", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const host = await openBoardWithEmptyWidgets({ emptyIds: ["w-2", "w-3"] });

    const banner = screen.getByTestId("empty-widgets-banner");
    expect(banner).toHaveTextContent("2 widgets on this dashboard have no data yet");
    await user.click(screen.getByRole("button", { name: "Ask Langy to set this up" }));

    const request = host.langyAsks.at(-1);
    expect(request?.question).toBeUndefined();
    expect(request?.draft).toContain('show no data: "Cost per trace", "Who uses it".');
    expect(request?.about).toEqual({ ref: BOARD.id });
  });
});

describe("given a board with Langy where one widget shows no data", () => {
  /** @scenario "AC13d Several empty widgets offer to ask Langy to set them up" */
  it("offers no setup", async () => {
    await openBoardWithEmptyWidgets({ emptyIds: ["w-2"] });

    expect(screen.queryByTestId("empty-widgets-banner")).toBeNull();
  });
});

describe("given a board without Langy where two widgets show no data", () => {
  /** @scenario "AC13d Several empty widgets offer to ask Langy to set them up" */
  it("offers no setup", async () => {
    await openBoardWithEmptyWidgets({ emptyIds: ["w-2", "w-3"], flags: LANGY_OFF });

    expect(screen.queryByTestId("empty-widgets-banner")).toBeNull();
  });
});

describe("given a board with Langy in a project that has received traces", () => {
  describe("when two widgets show no data over a quiet period", () => {
    /** @scenario "AC13d Several empty widgets offer to ask Langy to set them up" */
    it("offers no setup", async () => {
      await openBoardWithEmptyWidgets({ emptyIds: ["w-2", "w-3"], project: PROJECT_WITH_TRACES });

      expect(screen.queryByTestId("empty-widgets-banner")).toBeNull();
    });
  });
});

describe("given a From LangWatch board with Langy in a project that never received a trace", () => {
  /** @scenario "AC13d Several empty widgets offer to ask Langy to set them up" */
  it("counts each of its empty widgets and offers Langy to set them up", async () => {
    const board = curatedBoardById("data");
    if (!board) throw new Error("the data board is gone");
    renderDashboards({
      element: <CuratedBoardScreen />,
      host: new StubAnalyticsHost({
        flags: LANGY_ON,
        project: NEW_PROJECT,
        permissions: [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"],
        route: { params: { templateId: board.templateId }, query: {} },
      }),
      answer: (call) =>
        call.path === "analytics.lwql.query"
          ? Promise.resolve(lwqlResult({ rows: [] }))
          : boardServer({ emptyIds: [] })(call),
    });
    for (const frame of await screen.findAllByTestId("sandboxed-frame")) {
      const props = frames.get(frame);
      const widget = board.widgets.find(({ definition }) => definition.code === props?.code);
      if (!props || !widget) throw new Error("a frame matches no widget of the board");
      for (const { name } of widget.definition.queries) {
        await act(async () => {
          await props
            .executeQuery({ queryName: name, params: {}, signal: new AbortController().signal })
            .catch(() => undefined);
        });
      }
    }

    expect(screen.getByTestId("empty-widgets-banner")).toHaveTextContent(
      `${board.widgets.length} widgets on this dashboard have no data yet`,
    );
  });
});
