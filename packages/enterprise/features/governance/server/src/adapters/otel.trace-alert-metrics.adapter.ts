// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import { TraceAlertMetricsPort } from "../ports/governance-subscriber.port";

/**
 * The series name and its help text, pinned because two processes write them.
 *
 * This counter is the automation family's amplification signal: it counts the
 * match records written BEFORE any filter runs, so it is the number an operator
 * compares against the alerts actually delivered to tell "quiet week" from
 * "the filters are eating everything". A renamed series makes that comparison
 * silently unavailable — the panel goes empty, which reads as no traffic.
 *
 * IT CARRIES NO LABELS, AND THAT IS THE DESIGN. Project and trigger were
 * deliberately left off: this fires once per trace per trigger, so a project
 * label is unbounded and a trigger label very nearly so. Adding one here would
 * not break the panel, it would break the ingest. Per-project amplification is
 * a query against the trigger tables, not a metric.
 */
export const AUTOMATION_MATCH_RECORDS_METRIC_NAME = "automation_match_records_total";
export const AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION =
  "Trigger match records written before any filter is evaluated";

/** Trigger match-record volume, pushed over OTLP. */
export class OtelTraceAlertMetricsAdapter extends TraceAlertMetricsPort {
  static create(): OtelTraceAlertMetricsAdapter {
    return new OtelTraceAlertMetricsAdapter(
      counter({
        name: AUTOMATION_MATCH_RECORDS_METRIC_NAME,
        description: AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION,
      }),
    );
  }

  private constructor(private readonly records: CounterHandle) {
    super();
  }

  /**
   * The zero guard is the application's, kept: `inc(0)` is a write that moves
   * nothing, and a subscriber that matched no trigger calls this on every
   * single trace.
   */
  countRecorded(count: number): void {
    if (count > 0) this.records.inc(void 0, count);
  }
}
