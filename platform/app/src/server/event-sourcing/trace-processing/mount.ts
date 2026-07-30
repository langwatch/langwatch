import {
  ConfigurationError,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";

/**
 * `batch`, not `none`, on both folds: one delivery may carry several spans
 * for one trace, applied in order as a single unit of work.
 */
export const TRACE_SUMMARY_MOUNT: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

export const TRACE_ANALYTICS_MOUNT: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

/**
 * One lane per span event. `collapse: none` because an event-scoped lane can
 * never gather a batch; many such lanes still coalesce into one insert via
 * the store's `bulkAppend` (ADR-100 §4).
 */
export const SPAN_STORAGE_MOUNT: Mount = {
  projection: "map",
  store: "append",
  scope: "event",
  collapse: "none",
};

/** The rollup's aggregate is the bucket, not the trace. */
export const TRACE_ANALYTICS_ROLLUP_MOUNT: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

const MOUNTS: Readonly<Record<string, Mount>> = {
  traceSummary: TRACE_SUMMARY_MOUNT,
  traceAnalytics: TRACE_ANALYTICS_MOUNT,
  spanStorage: SPAN_STORAGE_MOUNT,
  traceAnalyticsRollup: TRACE_ANALYTICS_ROLLUP_MOUNT,
};

/** Refusal happens at composition, not on the first delivery (ADR-106). */
export function assertTraceProcessingMountsAreLegal(): void {
  const violations: string[] = [];
  for (const [name, mount] of Object.entries(MOUNTS)) {
    for (const v of validateMount(mount)) {
      violations.push(`${name}: ${v.rule} — ${v.message}`);
    }
  }
  if (violations.length > 0) {
    throw new ConfigurationError(
      `trace-processing has illegal mounts: ${violations.join("; ")}`,
      { pipeline: "trace_processing", violations },
    );
  }
}
