import { create } from "zustand";

import type { ChartFrameRenderReceipt } from "../bridge/frameBridge";

/**
 * The latest render receipt for one widget on the open dashboard, plus the
 * host context needed to make sense of it away from the frame.
 *
 * A receipt lives ONLY while the tab that produced it is open: it is what the
 * widget just painted in this browser, not a persisted artifact. That is the
 * whole point — Langy runs on the server and cannot see the tab, so this is
 * how "what does it look like right now" reaches it (through
 * `dashboard.getWidgetRender`).
 */
export interface WidgetRenderReceipt extends ChartFrameRenderReceipt {
  widgetId: string;
  widgetName?: string;
  dashboardId?: string;
  theme: "light" | "dark";
  /** The window the widget's queries ran against, epoch ms. */
  timeWindow: { start: number; end: number };
  /** `Date.now()` when the receipt was captured. */
  capturedAt: number;
}

interface WidgetRenderReceiptState {
  /** Latest receipt per widget, keyed by widgetId. One card, one entry. */
  receipts: Record<string, WidgetRenderReceipt>;
  /** Replace the receipt for a widget (a card only ever has one live view). */
  publish: (receipt: WidgetRenderReceipt) => void;
  /** Drop a widget's receipt when its card leaves the grid. */
  remove: (widgetId: string) => void;
  clear: () => void;
}

export const useWidgetRenderReceiptStore = create<WidgetRenderReceiptState>()(
  (set) => ({
    receipts: {},

    publish: (receipt) =>
      set((state) => ({
        receipts: { ...state.receipts, [receipt.widgetId]: receipt },
      })),

    remove: (widgetId) =>
      set((state) => {
        if (!(widgetId in state.receipts)) return state;
        const next = { ...state.receipts };
        delete next[widgetId];
        return { receipts: next };
      }),

    clear: () =>
      set((state) =>
        Object.keys(state.receipts).length === 0 ? state : { receipts: {} },
      ),
  }),
);

/**
 * Receipts as a sorted array, filtered to a dashboard and/or a single widget.
 *
 * Pure and separate from the store so the "receipts → answer" mapping the
 * `dashboard.getWidgetRender` handler needs is unit-testable without a React
 * tree. Sorted by widget name (id as a stable tie-break) so the agent reads
 * the same order a person scanning the dashboard would.
 */
export function listWidgetRenderReceipts({
  receipts,
  filter = {},
}: {
  receipts: Record<string, WidgetRenderReceipt>;
  filter?: { dashboardId?: string; widgetId?: string };
}): WidgetRenderReceipt[] {
  return Object.values(receipts)
    .filter(
      (receipt) =>
        (filter.dashboardId === undefined ||
          receipt.dashboardId === filter.dashboardId) &&
        (filter.widgetId === undefined || receipt.widgetId === filter.widgetId),
    )
    .sort(
      (a, b) =>
        (a.widgetName ?? "").localeCompare(b.widgetName ?? "") ||
        a.widgetId.localeCompare(b.widgetId),
    );
}

/** One widget row of `dashboard.getWidgetRender`'s result. */
export interface WidgetRenderResultRow {
  widgetId: string;
  widgetName: string | null;
  status: "ok" | "error";
  errorText: string | null;
  height: number;
  theme: "light" | "dark";
  timeWindow: { start: number; end: number };
  capturedAt: string;
  markup?: string;
  isMarkupTruncated: boolean;
}

export interface WidgetRenderResult {
  dashboardId: string | null;
  widgets: WidgetRenderResultRow[];
}

/**
 * Total markup, in characters, that one `dashboard.getWidgetRender` result may
 * carry across ALL of its widget rows.
 *
 * The UI-action channel replaces any completion whose serialized payload is
 * over 64 KB (`MAX_RESULT_BYTES` in `ui-action.service.ts`) with a
 * `result_too_large` error, so the agent gets nothing back. A single widget's
 * markup is already capped at `CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS` (60,000)
 * at capture, but nothing bounded the SUM across a multi-widget dashboard, so
 * `{"shouldIncludeMarkup":true}` on more than one card blew straight past the
 * ceiling. This budget is a shared allowance across rows, deliberately well
 * below 64 KB to leave headroom for JSON escaping (SVG quotes serialize to two
 * bytes each) and the non-markup fields of every row. Rows are filled in the
 * sorted order the agent reads; the row that would cross the budget is
 * truncated and every row from there on is flagged `isMarkupTruncated`.
 *
 * The channel measures the serialized payload in UTF-8 BYTES, so this budget is
 * counted in bytes too — a character budget would undercount multibyte labels
 * (a 45,000-char markup of three-byte glyphs is ~135,000 bytes) and could still
 * trip `result_too_large`.
 */
export const DASHBOARD_RENDER_RESULT_MARKUP_BUDGET_BYTES = 45_000;

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

/**
 * Longest prefix of `value` that encodes within `maxBytes` UTF-8 bytes, found
 * by binary search on the character length so a multibyte codepoint is never
 * split. Returns "" when even the first codepoint overflows.
 */
function truncateToUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8ByteLength(value.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(0, lo);
}

/**
 * The pure `receipts → dashboard.getWidgetRender result` mapping, kept out of
 * the page handler so it can be unit-tested without a React tree (the handler
 * is only the store read + this call).
 *
 * `shouldIncludeMarkup` defaults to true for a single widget and false for the whole
 * list — the markup of every card at once is a lot to hand an agent that only
 * wanted to know which ones errored. `capturedAt` becomes an ISO string, the
 * shape the result schema (and the agent) reads. Included markup is held to a
 * shared budget ({@link DASHBOARD_RENDER_RESULT_MARKUP_BUDGET_BYTES}) so the
 * whole result stays under the UI-action channel's 64 KB ceiling.
 */
export function buildWidgetRenderResult({
  receipts,
  dashboardId,
  widgetId,
  shouldIncludeMarkup,
}: {
  receipts: Record<string, WidgetRenderReceipt>;
  dashboardId: string | null;
  widgetId?: string;
  shouldIncludeMarkup?: boolean;
}): WidgetRenderResult {
  const isMarkupIncluded = shouldIncludeMarkup ?? widgetId !== undefined;
  const list = listWidgetRenderReceipts({
    receipts,
    filter: {
      ...(dashboardId === null ? {} : { dashboardId }),
      ...(widgetId === undefined ? {} : { widgetId }),
    },
  });
  let markupByteBudgetLeft = DASHBOARD_RENDER_RESULT_MARKUP_BUDGET_BYTES;
  return {
    dashboardId,
    widgets: list.map((receipt) => {
      const row = {
        widgetId: receipt.widgetId,
        widgetName: receipt.widgetName ?? null,
        status: receipt.status,
        errorText: receipt.errorText ?? null,
        height: receipt.height,
        theme: receipt.theme,
        timeWindow: receipt.timeWindow,
        capturedAt: new Date(receipt.capturedAt).toISOString(),
        isMarkupTruncated: receipt.isMarkupTruncated,
      };
      if (!isMarkupIncluded) return row;
      const full = receipt.markup ?? "";
      const markup = truncateToUtf8Bytes(full, markupByteBudgetLeft);
      markupByteBudgetLeft -= utf8ByteLength(markup);
      return {
        ...row,
        markup,
        isMarkupTruncated:
          receipt.isMarkupTruncated || markup.length < full.length,
      };
    }),
  };
}
