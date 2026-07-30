import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import { REPORT_DEBOUNCE_MS, REPORT_DEDUP_TTL_MS } from "../constants";
import type { ReportUsageForMonthData } from "./reportUsageForMonth";

/** The subset of `ReportUsageForMonthData` the dispatch identity is keyed on. */
type ReportUsageForMonthDedupKeyParams = Pick<
  ReportUsageForMonthData,
  "organizationId" | "billingMonth"
>;

/**
 * A `partition` scoped to `[organizationId, billingMonth]`, not `aggregate`
 * scoped to the organization alone: during the grace window both triggers
 * dispatch two months at once, and an `aggregate` scope naming only
 * `organizationId` could not tell them apart.
 */
export function reportUsageForMonthGroupKey(
  params: ReportUsageForMonthDedupKeyParams,
): GroupKey {
  return {
    tenantId: params.organizationId,
    lane: { kind: "command", name: "reportUsageForMonth" },
    scope: {
      kind: "partition",
      parts: [params.organizationId, params.billingMonth],
    },
  };
}

/**
 * How `reportUsageForMonth` is staged (ADR-100).
 *
 * `extend: false` is the whole point, not merely `ttlMs`. A window that
 * extends on every squash pushes its own dispatch further into the future on
 * every poke, so the organizations with the most continuous billable traffic —
 * the largest invoices — would be exactly the ones whose report never comes
 * due. Declining to extend closes the window on schedule; a later poke opens a
 * fresh one instead of postponing the staged one.
 */
export interface ReportUsageForMonthDispatchOptions {
  readonly delayMs: number;
  readonly deduplication: {
    readonly makeId: (params: ReportUsageForMonthDedupKeyParams) => string;
    readonly ttlMs: number;
    readonly extend: false;
  };
}

export const reportUsageForMonthDispatchOptions: ReportUsageForMonthDispatchOptions =
  {
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
