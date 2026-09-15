// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { counter, gauge } from "@langwatch/observability/metrics";

/**
 * ADR-128: the governance cost rollup's two watchdog series.
 *
 * The names and their labels are the ones the deleted `src/server/metrics.ts`
 * registered, unchanged, because dashboards and alerts read them by name. What
 * changed is only where they are declared: a module owns its own instruments
 * here rather than a single process-wide registry owning everybody's.
 */

/**
 * Times the daily cost rollup disagreed with the events it was built from.
 *
 * The comparator re-derives a sampled day straight from the event log and
 * compares it against the summarized figure. An increment means the number a
 * customer is being shown is not the number their events add up to — it does
 * NOT mean the rollup was repaired: the comparator surfaces the signal and
 * heals nothing, deliberately, because a self-healing rewrite would erase the
 * evidence of why the two ever diverged. The organization and the two figures
 * are on the log line beside it.
 *
 * A healthy fleet emits this at exactly zero.
 */
const governanceCostRollupMismatchCounter = counter({
  name: "langwatch_governance_cost_rollup_mismatch_total",
  description:
    "Days on which the governance cost rollup disagreed with the events it was derived from",
});

/**
 * How far behind the event log the rollup is, in seconds, per tenant and lane.
 *
 * A gauge and not an alert: ADR-128 wave 1 measures and sends nothing. The
 * value is the distance between the newest event's BUSINESS time and the
 * newest business time any summary row covers, so a lane that stopped folding
 * climbs steadily while a lane that is merely idle sits flat at zero.
 *
 * `tenant_id` is load-bearing, not detail. The check fires once per tenant,
 * and a gauge keyed only by lane would have each tenant overwrite the last:
 * the fleet's worst lag would sit invisible behind whichever tenant happened
 * to report most recently, which is the one reading this metric exists to
 * surface.
 *
 * The series are therefore per tenant, and a label set lives as long as the
 * exporter holds it — a deleted tenant's last reading lingers until the
 * process restarts. Acceptable for a lag gauge nobody alerts on; it would not
 * be if this ever became a paging signal.
 */
const governanceCostRollupLagGauge = gauge({
  name: "langwatch_governance_cost_rollup_lag_seconds",
  description:
    "Seconds between the newest cost event and the newest moment the rollup covers",
});

export function incrementGovernanceCostRollupMismatch(costSource: string): void {
  governanceCostRollupMismatchCounter.inc({ cost_source: costSource });
}

export function setGovernanceCostRollupLagSeconds({
  tenantId,
  costSource,
  seconds,
}: {
  tenantId: string;
  costSource: string;
  seconds: number;
}): void {
  // Named labels rather than positional: two same-typed labels next to each
  // other are silently swappable, and a swap here mislabels every series.
  governanceCostRollupLagGauge.set(seconds, {
    tenant_id: tenantId,
    cost_source: costSource,
  });
}
