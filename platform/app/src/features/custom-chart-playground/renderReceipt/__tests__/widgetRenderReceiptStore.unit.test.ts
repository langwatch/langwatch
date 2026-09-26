/**
 * @vitest-environment node
 *
 * The per-widget render-receipt store and the pure receipts→result mapping the
 * `dashboard.getWidgetRender` handler reads. A receipt lives only while its
 * card is mounted, so the store keeps one per widget and drops it on remove.
 *
 * @see specs/analytics/dashboard-widget-render-receipt.feature
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  buildWidgetRenderResult,
  DASHBOARD_RENDER_RESULT_MARKUP_BUDGET_CHARS,
  listWidgetRenderReceipts,
  useWidgetRenderReceiptStore,
  type WidgetRenderReceipt,
} from "../widgetRenderReceiptStore";

function makeReceipt(
  overrides: Partial<WidgetRenderReceipt> & { widgetId: string },
): WidgetRenderReceipt {
  return {
    status: "ok",
    markup: '<div id="lw-root"></div>',
    isMarkupTruncated: false,
    height: 200,
    widgetName: undefined,
    dashboardId: "dash_1",
    theme: "light",
    timeWindow: { start: 0, end: 1 },
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  useWidgetRenderReceiptStore.getState().clear();
});

describe("useWidgetRenderReceiptStore", () => {
  describe("when a widget publishes a receipt", () => {
    it("keeps it keyed by widget id, and a later one replaces the earlier", () => {
      const store = useWidgetRenderReceiptStore.getState();
      store.publish(makeReceipt({ widgetId: "w1", height: 100 }));
      store.publish(makeReceipt({ widgetId: "w1", height: 300 }));

      const { receipts } = useWidgetRenderReceiptStore.getState();
      expect(Object.keys(receipts)).toEqual(["w1"]);
      expect(receipts.w1?.height).toBe(300);
    });
  });

  describe("when a widget's card leaves the grid", () => {
    it("drops that widget's receipt and leaves the others", () => {
      const store = useWidgetRenderReceiptStore.getState();
      store.publish(makeReceipt({ widgetId: "w1" }));
      store.publish(makeReceipt({ widgetId: "w2" }));

      useWidgetRenderReceiptStore.getState().remove("w1");

      const { receipts } = useWidgetRenderReceiptStore.getState();
      expect(Object.keys(receipts)).toEqual(["w2"]);
    });
  });
});

describe("listWidgetRenderReceipts", () => {
  it("filters by dashboard and widget id and sorts by widget name", () => {
    const receipts = {
      b: makeReceipt({ widgetId: "b", widgetName: "Zeta", dashboardId: "d1" }),
      a: makeReceipt({ widgetId: "a", widgetName: "Alpha", dashboardId: "d1" }),
      other: makeReceipt({ widgetId: "c", dashboardId: "d2" }),
    };

    const onDashboard = listWidgetRenderReceipts({
      receipts,
      filter: {
        dashboardId: "d1",
      },
    });
    expect(onDashboard.map((r) => r.widgetId)).toEqual(["a", "b"]);

    const one = listWidgetRenderReceipts({
      receipts,
      filter: {
        dashboardId: "d1",
        widgetId: "b",
      },
    });
    expect(one.map((r) => r.widgetId)).toEqual(["b"]);
  });
});

describe("buildWidgetRenderResult", () => {
  describe("when one widget id is asked for", () => {
    /** @scenario Langy reads one widget's receipt with its markup */
    it("includes markup by default and renders capturedAt as an ISO string", () => {
      const receipts = {
        w1: makeReceipt({
          widgetId: "w1",
          widgetName: "Cost",
          markup: "<svg data-chart='1' />",
          capturedAt: 1_700_000_000_000,
        }),
      };

      const result = buildWidgetRenderResult({
        receipts,
        dashboardId: "dash_1",
        widgetId: "w1",
      });

      expect(result.dashboardId).toBe("dash_1");
      expect(result.widgets).toHaveLength(1);
      const widget = result.widgets[0]!;
      expect(widget.markup).toBe("<svg data-chart='1' />");
      expect(widget.widgetName).toBe("Cost");
      expect(widget.capturedAt).toBe(new Date(1_700_000_000_000).toISOString());
    });
  });

  describe("when no widget id is asked for", () => {
    /** @scenario Langy lists every widget on the open dashboard without markup */
    it("lists every widget on the dashboard without markup", () => {
      const receipts = {
        w1: makeReceipt({ widgetId: "w1", widgetName: "A" }),
        w2: makeReceipt({
          widgetId: "w2",
          widgetName: "B",
          status: "error",
          errorText: "boom",
        }),
      };

      const result = buildWidgetRenderResult({
        receipts,
        dashboardId: "dash_1",
      });

      expect(result.widgets.map((w) => w.widgetId)).toEqual(["w1", "w2"]);
      expect(result.widgets.every((w) => w.markup === undefined)).toBe(true);
      expect(result.widgets[1]?.status).toBe("error");
      expect(result.widgets[1]?.errorText).toBe("boom");
    });

    it("still includes markup when shouldIncludeMarkup is explicitly true", () => {
      const receipts = {
        w1: makeReceipt({ widgetId: "w1", markup: "<svg/>" }),
      };

      const result = buildWidgetRenderResult({
        receipts,
        dashboardId: "dash_1",
        shouldIncludeMarkup: true,
      });

      expect(result.widgets[0]?.markup).toBe("<svg/>");
    });
  });

  describe("when the markup across widgets would exceed the result budget", () => {
    it("truncates rows past the shared budget and flags them, so the whole result stays under the channel ceiling", () => {
      // Three widgets each carrying markup a third of the budget plus a bit,
      // so the third must be cut. Big enough that unbounded aggregation would
      // sail past the UI-action channel's 64 KB result ceiling.
      const chunk = "x".repeat(20_000);
      const receipts = {
        a: makeReceipt({ widgetId: "a", widgetName: "a", markup: chunk }),
        b: makeReceipt({ widgetId: "b", widgetName: "b", markup: chunk }),
        c: makeReceipt({ widgetId: "c", widgetName: "c", markup: chunk }),
      };

      const result = buildWidgetRenderResult({
        receipts,
        dashboardId: "dash_1",
        shouldIncludeMarkup: true,
      });

      const totalMarkup = result.widgets.reduce(
        (sum, w) => sum + (w.markup?.length ?? 0),
        0,
      );
      expect(totalMarkup).toBeLessThanOrEqual(
        DASHBOARD_RENDER_RESULT_MARKUP_BUDGET_CHARS,
      );
      // Something was cut, so at least one row must say so.
      expect(result.widgets.some((w) => w.isMarkupTruncated)).toBe(true);
    });

    it("does not flag a receipt whose full markup fit within the budget", () => {
      const receipts = {
        w1: makeReceipt({ widgetId: "w1", markup: "<svg/>" }),
      };

      const result = buildWidgetRenderResult({
        receipts,
        dashboardId: "dash_1",
        shouldIncludeMarkup: true,
      });

      expect(result.widgets[0]?.markup).toBe("<svg/>");
      expect(result.widgets[0]?.isMarkupTruncated).toBe(false);
    });
  });
});
