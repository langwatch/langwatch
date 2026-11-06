/**
 * @vitest-environment jsdom
 * Each board's widget card tells the frame who reads it, and the curated board warns when
 * several widgets hit a limit. Only the sandboxed frame is stood in for; the failure travels the
 * real executor and frame.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import { UiProcedureRefusal, type UiProcedureAnswer } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen } from "@testing-library/react";
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

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import type { BoardPeriod } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";
import { curatedBoardById } from "../model/curated-boards.ts";
import { BoardWidgetCard } from "../ui/sections/board-widget-card.tsx";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import { CuratedWidgetCard } from "../ui/sections/curated-widget-card.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const PERIOD: BoardPeriod = { periodStart: 1_000, periodEnd: 2_000, granularitySeconds: 3600 };
const DEFINITION = {
  version: 1 as const,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql: "SELECT count() AS n FROM analytics.traces" }],
};
const BUILT_IN_WORDS =
  "This widget hit a LangWatch limit in the selected period. This is not a problem with your data.";

const overMemory: UiProcedureAnswer = (call) => {
  if (call.path === "analytics.lwql.query") {
    return Promise.reject(new UiProcedureRefusal("query_memory_exceeded", 422));
  }
  if (call.path === "boards.getAll" || call.path === "boards.listStarred") {
    return Promise.resolve([]);
  }
  return NO_PROCEDURES(call);
};

/** Runs the first query of each frame on screen, in order, the way the widget's code would. */
async function framesRun({ queryNames }: { queryNames: readonly string[] }) {
  const found = await screen.findAllByTestId("sandboxed-frame");
  for (const [index, frame] of found.entries()) {
    const props = frames.get(frame);
    const queryName = queryNames[index];
    if (!props || !queryName) continue;
    await act(async () => {
      await props
        .executeQuery({ queryName, params: {}, signal: new AbortController().signal })
        .catch(() => undefined);
    });
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a limit failure on a From LangWatch widget", () => {
  /** @scenario "A built-in widget that fails on a limit says the limit is LangWatch's" */
  it("says the limit is LangWatch's and offers Retry and no edit action", async () => {
    renderDashboards({
      element: (
        <CuratedWidgetCard
          widget={{
            key: "volume",
            name: "Volume",
            definition: DEFINITION,
            layout: { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
          }}
          frameId="release-volume"
          boardName="Release check"
          projectId="proj-1"
          projectSlug="test-project"
          rowSpan={4}
          timeWindow={{ start: 1_000, end: 2_000 }}
          granularitySeconds={3600}
          periodKey="30d:auto"
        />
      ),
      host: new StubAnalyticsHost({ permissions: [...ANALYTICS_MEMBER_PERMISSIONS] }),
      answer: overMemory,
    });
    await framesRun({ queryNames: ["main"] });

    expect(screen.getByText(BUILT_IN_WORDS)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit code" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit with Langy" })).toBeNull();
  });
});

describe("given a limit failure on a stored board's widget while the board is being written", () => {
  /** @scenario "Edit actions wait while the board is being written" */
  it("disables the edit actions but not Retry", async () => {
    const widget: BoardWidget = {
      id: "w-1",
      name: "Volume",
      definition: DEFINITION,
      placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
    };
    renderDashboards({
      element: (
        <BoardWidgetCard
          widget={widget}
          projectId="proj-1"
          projectSlug="checkout"
          dashboardId="board-1"
          boardName="Weekly review"
          period={PERIOD}
          periodKey="30d:auto"
          isWriting
          langy={{ ask: vi.fn(), setUp: vi.fn(), setUpMissing: vi.fn() }}
          onEdit={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
        />
      ),
      host: new StubAnalyticsHost({
        permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
        project: { id: "proj-1", slug: "checkout", name: "Checkout Agent", hasFirstMessage: true },
      }),
      answer: overMemory,
    });
    await framesRun({ queryNames: ["main"] });

    expect(screen.getByRole("button", { name: "Edit code" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit with Langy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
});

describe("given several widgets of a From LangWatch board end on a limit failure", () => {
  /** @scenario "Two widgets that failed on a limit are told once above the board" */
  it("shows the limit warning above the board", async () => {
    const widgets = curatedBoardById("release")?.widgets ?? [];
    renderDashboards({
      element: <CuratedBoardScreen />,
      host: new StubAnalyticsHost({
        flags: { release_dashboards: true },
        permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
        route: { params: { templateId: "release" }, query: {} },
      }),
      answer: overMemory,
    });
    await framesRun({
      queryNames: widgets.map(({ definition }) => definition.queries[0]?.name ?? ""),
    });

    expect(await screen.findByTestId("limit-failed-widgets-banner")).toBeInTheDocument();
  });
});
