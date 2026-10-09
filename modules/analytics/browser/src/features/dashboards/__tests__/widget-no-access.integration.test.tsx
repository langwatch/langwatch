/**
 * @vitest-environment jsdom
 * A widget whose reader may not see its data: the server's refusal travels the real transport
 * and executor to the card, which says what is withheld and offers nothing that would read it.
 * Only the sandboxed frame is stood in for, since jsdom cannot run it.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import { UiProcedureRefusal, type UiProcedureAnswer } from "@langwatch/browser/testing-transport";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { frameProps } = vi.hoisted(() => ({
  frameProps: vi.fn<(props: SandboxedChartFrameProps) => void>(),
}));

vi.mock("../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: SandboxedChartFrameProps) => {
    frameProps(props);
    return <div data-testid="sandboxed-frame" />;
  },
}));

import { StubAnalyticsHost } from "../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import type { BoardPeriod } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";
import { BoardWidgetCard, type WidgetCardLangy } from "../ui/sections/board-widget-card.tsx";
import { CuratedWidgetCard } from "../ui/sections/curated-widget-card.tsx";
import { renderDashboards } from "./render-dashboards.test-helpers.tsx";

const PERIOD: BoardPeriod = { periodStart: 1_000, periodEnd: 2_000, granularitySeconds: 3600 };
const DEFINITION = {
  version: 1 as const,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql: "SELECT sum(TotalCost) AS cost FROM analytics.traces" }],
};
const WIDGET: BoardWidget = {
  id: "w-1",
  name: "Cost per trace",
  definition: DEFINITION,
  placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
};
const VIEWER = ["analytics:view", "traces:view"];
const LANGY: WidgetCardLangy = { ask: vi.fn(), setUp: vi.fn(), setUpMissing: vi.fn() };

/** The server's answer to a reader without cost:view, as the query door sends it. */
const refusedForCost: UiProcedureAnswer = ({ path }) =>
  path === "analytics.lwql.query"
    ? Promise.reject(
        new UiProcedureRefusal("lwql_not_permitted", 400, {
          violations: [
            {
              code: "GATED_COLUMN",
              clause: "projection",
              message: 'The field "TotalCost" is not available to you. Remove it from the query.',
              hint: "Remove the field.",
              missingGates: ["cost:view"],
            },
          ],
        }),
      )
    : Promise.reject(new Error(`No test answer for ${path}`));

/** The same refusal with nothing saying what the reader lacks: a query that is broken. */
const refusedForShape: UiProcedureAnswer = ({ path }) =>
  path === "analytics.lwql.query"
    ? Promise.reject(
        new UiProcedureRefusal("lwql_not_permitted", 400, {
          violations: [
            { code: "SETTINGS_CLAUSE", clause: "statement", message: "No.", hint: "Remove it." },
          ],
        }),
      )
    : Promise.reject(new Error(`No test answer for ${path}`));

/** The frame runs the widget's one query, as its code would on load. */
async function frameRunsItsQuery() {
  const props = frameProps.mock.calls.at(-1)?.[0];
  if (!props) throw new Error("the frame never rendered");
  await act(async () => {
    await props
      .executeQuery({ queryName: "main", params: {}, signal: new AbortController().signal })
      .catch(() => undefined);
  });
}

function storedCard({
  answer,
  permissions = VIEWER,
  langy = LANGY,
}: {
  answer: UiProcedureAnswer;
  permissions?: readonly string[];
  langy?: WidgetCardLangy;
}) {
  const host = new StubAnalyticsHost({
    permissions,
    project: { id: "proj-1", slug: "checkout", name: "Checkout Agent", hasFirstMessage: true },
  });
  renderDashboards({
    element: (
      <BoardWidgetCard
        widget={WIDGET}
        projectId="proj-1"
        projectSlug="checkout"
        dashboardId="board-1"
        period={PERIOD}
        isWriting={false}
        langy={langy}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    ),
    host,
    answer,
  });
  return host;
}

async function menuItems(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Actions for Cost per trace" }));
  const menu = await screen.findByRole("menu");
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.trim());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a stored board's widget whose query reads cost", () => {
  describe("when the server refuses it because the reader lacks cost:view", () => {
    /** @scenario "A widget the reader may not see says so in place of the chart" */
    it("says what is withheld and who to ask, with no failure, Retry or refusal text", async () => {
      storedCard({ answer: refusedForCost });
      await frameRunsItsQuery();

      const face = screen.getByTestId("widget-state-face");
      expect(face).toHaveTextContent("Cost figures are hidden for your role");
      expect(face).toHaveTextContent("Ask an admin of Checkout Agent if you need to see them.");
      expect(screen.getByText("Cost per trace")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(screen.queryByText(/Couldn't load/)).toBeNull();
      expect(screen.queryByText(/TotalCost/)).toBeNull();
    });

    /** @scenario "A widget with no access offers nothing that reads its data" */
    it("offers no Langy action and no Edit code to a reader who may not edit widgets", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      storedCard({ answer: refusedForCost });
      await frameRunsItsQuery();

      expect(screen.queryByRole("button", { name: "Ask Langy about Cost per trace" })).toBeNull();
      expect(await menuItems(user)).toEqual([
        "Copy widget id",
        "Copy API snippet",
        "Duplicate",
        "Delete",
      ]);
    });

    /** @scenario "A widget with no access offers nothing that reads its data" */
    it("keeps Edit code for a reader who may edit widgets", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      storedCard({ answer: refusedForCost, permissions: [...VIEWER, "analytics:update"] });
      await frameRunsItsQuery();

      expect(await menuItems(user)).toEqual([
        "Edit code",
        "Copy widget id",
        "Copy API snippet",
        "Duplicate",
        "Delete",
      ]);
    });
  });

  describe("when the server refuses it for the query's shape", () => {
    it("fails the widget by name with Retry, and keeps every action", async () => {
      storedCard({ answer: refusedForShape });
      await frameRunsItsQuery();

      expect(screen.getByText("Couldn't load Cost per trace")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Ask Langy about Cost per trace" }),
      ).toBeInTheDocument();
    });
  });

  describe("when its query has not answered yet", () => {
    it("offers every action, Langy's included", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      storedCard({ answer: refusedForCost });

      expect(
        screen.getByRole("button", { name: "Ask Langy about Cost per trace" }),
      ).toBeInTheDocument();
      expect(await menuItems(user)).toEqual([
        "Edit with Langy",
        "Edit code",
        "Copy widget id",
        "Copy API snippet",
        "Set an alert",
        "Send as a report",
        "Duplicate",
        "Delete",
      ]);
    });
  });
});

describe("given a From LangWatch board's widget whose query reads cost", () => {
  describe("when the server refuses it because the reader lacks cost:view", () => {
    /** @scenario "A From LangWatch widget with no access offers no Ask Langy" */
    it("keeps its title, shows the no access state and offers no Ask Langy", async () => {
      const host = new StubAnalyticsHost({ permissions: VIEWER });
      renderDashboards({
        element: (
          <CuratedWidgetCard
            widget={{
              key: "cost",
              name: "Cost per trace",
              definition: DEFINITION,
              layout: { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
            }}
            frameId="costs-cost"
            projectId="proj-1"
            projectSlug="test-project"
            rowSpan={4}
            timeWindow={{ start: 1_000, end: 2_000 }}
            granularitySeconds={3600}
            onAskLangy={vi.fn()}
          />
        ),
        host,
        answer: refusedForCost,
      });
      expect(
        screen.getByRole("button", { name: "Ask Langy about Cost per trace" }),
      ).toBeInTheDocument();

      await frameRunsItsQuery();

      expect(screen.getByText("Cost per trace")).toBeInTheDocument();
      expect(screen.getByTestId("widget-state-face")).toHaveTextContent(
        "Cost figures are hidden for your role",
      );
      expect(screen.queryByRole("button", { name: "Ask Langy about Cost per trace" })).toBeNull();
    });
  });
});
