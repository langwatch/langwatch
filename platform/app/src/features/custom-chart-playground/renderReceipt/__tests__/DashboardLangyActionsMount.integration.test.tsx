/**
 * @vitest-environment jsdom
 *
 * The dashboard (Reports) page's side of the UI-action channel: the handler it
 * registers with Langy while the page is open, run against the real render-
 * receipt store. Langy's context is the boundary and is stubbed to capture
 * what the page registers. Mirrors ExplorerLangyActionsMount's test.
 *
 * @see specs/analytics/dashboard-widget-render-receipt.feature
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";
import { DashboardLangyActionsMount } from "../DashboardLangyActionsMount";
import {
  useWidgetRenderReceiptStore,
  type WidgetRenderReceipt,
} from "../widgetRenderReceiptStore";

const { registerActions } = vi.hoisted(() => ({ registerActions: vi.fn() }));

vi.mock("~/features/langy/LangyContext", () => ({
  useRegisterLangyActions: (handlers: LangyUiActionHandlers) => {
    registerActions(handlers);
    return undefined;
  },
}));

function registered(): LangyUiActionHandlers {
  const handlers = registerActions.mock.calls.at(-1)?.[0] as
    | LangyUiActionHandlers
    | undefined;
  if (!handlers) throw new Error("the page registered nothing");
  return handlers;
}

/** Run one registered handler the way `executeUiAction` does. */
async function call(kind: string, payload: unknown): Promise<unknown> {
  const handler = registered()[kind];
  if (!handler) throw new Error(`no handler for ${kind}`);
  return await handler.run(handler.payloadSchema.parse(payload) as never);
}

function makeReceipt(
  overrides: Partial<WidgetRenderReceipt> & { widgetId: string },
): WidgetRenderReceipt {
  return {
    status: "ok",
    markup: '<div id="lw-root"></div>',
    isMarkupTruncated: false,
    height: 200,
    widgetName: overrides.widgetId,
    dashboardId: "dash-1",
    theme: "light",
    timeWindow: { start: 0, end: 1 },
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

type WidgetRow = { widgetId: string; markup?: string };
type Result = { dashboardId: string | null; widgets: WidgetRow[] };

beforeEach(() => {
  registerActions.mockClear();
  useWidgetRenderReceiptStore.getState().clear();
});

afterEach(() => {
  cleanup();
});

describe("given the dashboard (Reports) page is open", () => {
  describe("when the page mounts", () => {
    it("registers the dashboard.getWidgetRender handler with Langy", () => {
      render(<DashboardLangyActionsMount activeDashboardId="dash-1" />);
      expect(Object.keys(registered())).toEqual(["dashboard.getWidgetRender"]);
    });
  });

  describe("when Langy calls dashboard.getWidgetRender with the dashboard open", () => {
    it("answers scoped to the open dashboard and never another dashboard's cards", async () => {
      const store = useWidgetRenderReceiptStore.getState();
      store.publish(makeReceipt({ widgetId: "open", dashboardId: "dash-1" }));
      store.publish(
        makeReceipt({ widgetId: "elsewhere", dashboardId: "dash-2" }),
      );

      render(<DashboardLangyActionsMount activeDashboardId="dash-1" />);
      const result = (await call("dashboard.getWidgetRender", {})) as Result;

      expect(result.dashboardId).toBe("dash-1");
      expect(result.widgets.map((w) => w.widgetId)).toEqual(["open"]);
      // A bare list omits markup — the agent asked which cards, not their pixels.
      expect(result.widgets[0]?.markup).toBeUndefined();
    });

    it("includes the requested widget's markup when a widgetId is given", async () => {
      useWidgetRenderReceiptStore.getState().publish(
        makeReceipt({
          widgetId: "open",
          dashboardId: "dash-1",
          markup: "<svg>x</svg>",
        }),
      );

      render(<DashboardLangyActionsMount activeDashboardId="dash-1" />);
      const result = (await call("dashboard.getWidgetRender", {
        widgetId: "open",
      })) as Result;

      expect(result.widgets).toHaveLength(1);
      expect(result.widgets[0]?.markup).toBe("<svg>x</svg>");
    });
  });
});
