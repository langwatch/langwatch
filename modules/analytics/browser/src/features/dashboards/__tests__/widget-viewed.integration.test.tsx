/**
 * @vitest-environment jsdom
 * A widget card sends "dashboards.viewed.widget" the first time it shows on screen, once per
 * mount. The browser's IntersectionObserver is stood in for, so the test says what is on screen.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import type * as BrowserHostAnalytics from "@langwatch/browser-host/analytics";
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tracked } = vi.hoisted(() => ({ tracked: { events: [] as UiAnalyticsEvent[] } }));

vi.mock("@langwatch/browser-host/analytics", async (importActual) => {
  const actual = await importActual<typeof BrowserHostAnalytics>();
  const recorder = {
    track: (event: UiAnalyticsEvent) => tracked.events.push(event),
    register: () => void 0,
    unregister: () => void 0,
    identify: () => void 0,
    group: () => void 0,
    reset: () => void 0,
  };
  return { ...actual, useUiAnalytics: () => recorder };
});

vi.mock("../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: () => <div data-testid="sandboxed-frame" />,
}));

import { StubAnalyticsHost } from "../../../testing.tsx";
import type { BoardPeriod } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";
import { BoardWidgetCard } from "../ui/sections/board-widget-card.tsx";
import { CuratedWidgetCard } from "../ui/sections/curated-widget-card.tsx";
import { renderDashboards } from "./render-dashboards.test-helpers.tsx";

const PERIOD: BoardPeriod = {
  periodStart: Date.UTC(2026, 9, 1),
  periodEnd: Date.UTC(2026, 9, 8),
  granularitySeconds: 86_400,
};
const DEFINITION = {
  version: 1 as const,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql: "SELECT 1" }],
};
const NO_ANSWER = () => new Promise<never>(() => void 0);

/** Every observer the cards made, so a test can say their card came on screen. */
const observers: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];

class StandInIntersectionObserver {
  private readonly entry;
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.entry.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Tells every live observer whether its card is on screen. */
function cardsShow({ onScreen }: { onScreen: boolean }) {
  act(() => {
    for (const observer of observers.filter(({ disconnected }) => !disconnected)) {
      observer.callback(
        [{ isIntersecting: onScreen } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
  });
}

function storedCard(widget: BoardWidget) {
  renderDashboards({
    element: (
      <BoardWidgetCard
        widget={widget}
        projectId="proj-1"
        projectSlug="test-project"
        dashboardId="board-1"
        boardName="Weekly review"
        period={PERIOD}
        isWriting={false}
      />
    ),
    host: new StubAnalyticsHost(),
    answer: NO_ANSWER,
  });
}

const viewed = () =>
  tracked.events.filter(({ action, name }) => action === "viewed" && name === "widget");

beforeEach(() => {
  tracked.events.length = 0;
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", StandInIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("given a board's widget card", () => {
  const widget: BoardWidget = {
    id: "w-1",
    name: "Spend by model",
    definition: { ...DEFINITION, source: { kind: "langy" } },
    placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
  };

  /** @scenario "Telemetry: a widget on screen sends dashboards.viewed.widget once per board view" */
  it("sends nothing until the card shows, then one view with where the widget came from", () => {
    storedCard(widget);
    cardsShow({ onScreen: false });
    expect(viewed()).toEqual([]);

    cardsShow({ onScreen: true });
    cardsShow({ onScreen: true });

    expect(viewed()).toEqual([
      {
        boundary: "dashboards",
        name: "widget",
        action: "viewed",
        attributes: { widgetSource: "langy" },
      },
    ]);
  });

  /** @scenario "Telemetry: a widget on screen sends dashboards.viewed.widget once per board view" */
  it("counts a widget saved before its source was kept as unknown", () => {
    storedCard({ ...widget, definition: DEFINITION });
    cardsShow({ onScreen: true });

    expect(viewed().map(({ attributes }) => attributes)).toEqual([{ widgetSource: "unknown" }]);
  });

  /** @scenario "Telemetry: a widget on screen sends dashboards.viewed.widget once per board view" */
  it("sends a view again when the board is opened again", () => {
    storedCard(widget);
    cardsShow({ onScreen: true });
    cleanup();
    storedCard(widget);
    cardsShow({ onScreen: true });

    expect(viewed()).toHaveLength(2);
  });
});

describe("given a From LangWatch board's widget card", () => {
  /** @scenario "Telemetry: a widget on screen sends dashboards.viewed.widget once per board view" */
  it("sends one view with the curated source", () => {
    renderDashboards({
      element: (
        <CuratedWidgetCard
          widget={{
            key: "spend",
            name: "Spend by model",
            definition: DEFINITION,
            layout: { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
          }}
          frameId="costs-spend"
          templateId="costs"
          boardName="Running costs"
          projectId="proj-1"
          projectSlug="test-project"
          rowSpan={4}
          timeWindow={{ start: PERIOD.periodStart, end: PERIOD.periodEnd }}
          granularitySeconds={PERIOD.granularitySeconds}
        />
      ),
      host: new StubAnalyticsHost(),
      answer: NO_ANSWER,
    });
    cardsShow({ onScreen: true });

    expect(viewed().map(({ attributes }) => attributes)).toEqual([{ widgetSource: "curated" }]);
  });
});
