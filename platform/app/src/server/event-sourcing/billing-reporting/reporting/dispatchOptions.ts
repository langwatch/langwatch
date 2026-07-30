import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import { REPORT_DEBOUNCE_MS, REPORT_DEDUP_TTL_MS } from "../constants";
import type { ReportUsageForMonthData } from "./reportUsageForMonth";

/** The subset of `ReportUsageForMonthData` the dispatch identity is keyed on. */
type ReportUsageForMonthDedupKeyParams = Pick<
  ReportUsageForMonthData,
  "organizationId" | "billingMonth"
>;

/**
 * The command's dispatch-plane identity (ADR-100): a `partition` scoped to
 * `[organizationId, billingMonth]`, not `aggregate` scoped to the
 * organization alone — an organization's current and previous month must be
 * able to dispatch independently during the grace window (`billingMeterPoke.ts`,
 * `billingMeterSweep.ts` both dispatch two months at once there), which an
 * `aggregate` scope naming only `organizationId` could not distinguish.
 */
export function reportUsageForMonthGroupKey(params: ReportUsageForMonthDedupKeyParams): GroupKey {
  return {
    tenantId: params.organizationId,
    lane: { kind: "command", name: "reportUsageForMonth" },
    scope: { kind: "partition", parts: [params.organizationId, params.billingMonth] },
  };
}

/**
 * How `reportUsageForMonth` must be staged once a real dispatcher exists
 * (ADR-100). Not enforced by this pipeline itself — there is no queue mount
 * point in `@langwatch/event-sourcing` yet (see `index.ts`) — but the numbers
 * are load-bearing, so they are declared once here rather than re-derived at
 * whichever composition root eventually wires the dispatch.
 *
 * `extend: false` is the whole point, not merely `ttlMs`. A dedup window that
 * *extends* on every squash pushes its own dispatch further into the future
 * on every poke — `pipeline.reportDedupWindow`-style starvation — so the
 * organizations with the most continuous billable traffic (the largest
 * invoices) would be exactly the ones whose report never comes due. Declining
 * to extend closes the window on schedule; the poke that lands after it opens
 * a fresh one instead of postponing the one already staged.
 *
 * `makeId` renders the same `GroupKey` descriptor `reportUsageForMonthGroupKey`
 * declares, rather than hand-concatenating a string — ADR-100 names the
 * pre-rewrite version of exactly this (a dedup key built with `:` while the
 * group key it identifies is built with `/`) as "two hand-written conventions
 * for the same identity", which is the divergence a shared renderer closes.
 */
export interface ReportUsageForMonthDispatchOptions {
  readonly delayMs: number;
  readonly deduplication: {
    readonly makeId: (params: ReportUsageForMonthDedupKeyParams) => string;
    readonly ttlMs: number;
    readonly extend: false;
  };
}

export const reportUsageForMonthDispatchOptions: ReportUsageForMonthDispatchOptions = {
  delayMs: REPORT_DEBOUNCE_MS,
  deduplication: {
    makeId: (params) => renderGroupKey(reportUsageForMonthGroupKey(params)),
    // Longer than the debounce so the key still points at the staged job when
    // that job comes due, rather than expiring first and letting a second job
    // stage for the same window.
    ttlMs: REPORT_DEDUP_TTL_MS,
    extend: false,
  },
};
