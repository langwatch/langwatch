/**
 * @vitest-environment jsdom
 */

/**
 * Screen/grid wiring around a mocked DashboardWidgetFrame: nine cards, per-card
 * isolation, and the flag / LangWatchQL gates.
 * @see modules/analytics/specs/analytics-v2.feature
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_V2_WIDGETS,
  type AnalyticsV2Widget,
} from "../../../../features/analytics-v2/model/analytics-v2-widgets.ts";
import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../../testing.tsx";

const state = vi.hoisted(() => ({
  flagEnabled: true,
  flagLoading: false,
  lwqlAvailable: true,
  throwForId: null as string | null,
  frameCalls: [] as { id: string; graph: unknown }[],
}));

vi.mock("../../analytics-layout.tsx", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: state.flagEnabled, isLoading: state.flagLoading }),
}));

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    analytics: {
      lwql: {
        availability: {
          useQuery: () => ({
            data: { available: state.lwqlAvailable },
            isLoading: false,
            error: null,
          }),
        },
      },
    },
  },
}));

vi.mock("../../dashboard-widget-frame.tsx", () => ({
  DashboardWidgetFrame: (props: { id: string; graph: unknown }) => {
    state.frameCalls.push({ id: props.id, graph: props.graph });
    if (state.throwForId === props.id) {
      throw new Error(`widget ${props.id} crashed`);
    }
    return <div data-testid="frame">{props.id}</div>;
  },
}));

import AnalyticsV2Page from "../analytics-v2.screen.tsx";

const renderPage = () =>
  render(
    <AnalyticsTestHarness host={new StubAnalyticsHost({ permissions: ["analytics:view"] })}>
      <AnalyticsV2Page />
    </AnalyticsTestHarness>,
  );

beforeEach(() => {
  state.flagEnabled = true;
  state.flagLoading = false;
  state.lwqlAvailable = true;
  state.throwForId = null;
  state.frameCalls = [];
});
afterEach(cleanup);

describe("the Analytics v2 screen", () => {
  describe("given the release flag on and LangWatchQL available", () => {
    /** @scenario "The Analytics v2 page shows the nine charts" */
    it("shows nine widget cards, titled in contract order, each rendering its own definition", () => {
      renderPage();

      for (const widget of ANALYTICS_V2_WIDGETS) {
        const card = screen.getByTestId(`analytics-v2-widget-${widget.id}`);
        expect(card).toHaveTextContent(widget.title);
      }
      expect(screen.getAllByTestId("frame")).toHaveLength(9);
      expect(state.frameCalls.map((c) => c.id)).toEqual(
        ANALYTICS_V2_WIDGETS.map((w: AnalyticsV2Widget) => w.id),
      );
      for (const call of state.frameCalls) {
        const widget = ANALYTICS_V2_WIDGETS.find((w: AnalyticsV2Widget) => w.id === call.id);
        expect(call.graph).toEqual(widget?.definition);
      }
    });

    describe("when one widget throws while rendering", () => {
      /** @scenario "One failing widget does not take the other eight down" */
      it("shows a failure for that card and still renders the other eight", () => {
        state.throwForId = "top-models";
        renderPage();

        expect(screen.getByText("This chart could not be rendered.")).toBeInTheDocument();
        expect(screen.getAllByTestId("frame")).toHaveLength(8);
      });
    });
  });

  describe("given the release flag off", () => {
    /** @scenario "The Analytics v2 page is hidden until the release flag is on" */
    it("shows the not-available message and renders no widget cards", () => {
      state.flagEnabled = false;
      renderPage();

      expect(screen.getByTestId("analytics-v2-not-available")).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^analytics-v2-widget-/)).toHaveLength(0);
    });
  });

  describe("given the flag on but LangWatchQL not available", () => {
    /** @scenario "A project without LangWatchQL sees one clear message" */
    it("shows the disabled message and renders no widget cards", () => {
      state.lwqlAvailable = false;
      renderPage();

      expect(screen.getByTestId("analytics-v2-lwql-disabled")).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^analytics-v2-widget-/)).toHaveLength(0);
    });
  });
});
