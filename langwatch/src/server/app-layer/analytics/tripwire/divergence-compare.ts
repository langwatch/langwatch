/**
 * ADR-034 tripwire — compares the routed analytics result to the legacy
 * `trace_summaries` result and logs a structured warning when any bucket
 * diverges beyond the numeric tolerance.
 *
 * Pure log side-effect — never throws, never modifies either result. The
 * routed result still flows through to the caller even if the comparator
 * crashes (try/catch around the body).
 *
 * Lives in its own module (separate from the service) so the service stays
 * about flag-and-dispatch and the tripwire stays about comparison + logging.
 */

import type { TimeseriesResult } from "~/server/analytics/types";
import { createLogger } from "~/utils/logger/server";
import type { AnalyticsTable } from "../routing/route-table";

/**
 * Numeric tolerance (fraction of max(|routed|, |legacy|)) below which the
 * tripwire considers a bucket pair equivalent. 0.1% — wide enough to absorb
 * float rounding + tiny re-delivery double-counts the rollup explicitly
 * accepts (ADR-034), tight enough to flag systematic drift.
 */
const TRIPWIRE_NUMERIC_TOLERANCE = 0.001 as const;

const tripwireLogger = createLogger("langwatch:analytics:tripwire");

export interface CompareForTripwireInput {
  projectId: string;
  table: AnalyticsTable;
  routed: TimeseriesResult;
  legacy: TimeseriesResult;
}

export function compareForTripwire(input: CompareForTripwireInput): void {
  const { projectId, table, routed, legacy } = input;
  try {
    const divergences: Array<{
      period: "current" | "previous";
      date: string;
      metric: string;
      routed: number;
      legacy: number;
      relativeDelta: number;
    }> = [];

    for (const period of ["current", "previous"] as const) {
      const routedBuckets =
        period === "current" ? routed.currentPeriod : routed.previousPeriod;
      const legacyBuckets =
        period === "current" ? legacy.currentPeriod : legacy.previousPeriod;
      const legacyByDate = new Map(legacyBuckets.map((b) => [b.date, b]));

      for (const r of routedBuckets) {
        const l = legacyByDate.get(r.date);
        if (!l) continue;
        for (const key of Object.keys(r)) {
          if (key === "date") continue;
          const rv = r[key];
          const lv = l[key];
          if (typeof rv !== "number" || typeof lv !== "number") continue;
          const denom = Math.max(Math.abs(rv), Math.abs(lv));
          if (denom === 0) continue;
          const delta = Math.abs(rv - lv) / denom;
          if (delta > TRIPWIRE_NUMERIC_TOLERANCE) {
            divergences.push({
              period,
              date: r.date,
              metric: key,
              routed: rv,
              legacy: lv,
              relativeDelta: delta,
            });
          }
        }
      }
    }

    if (divergences.length > 0) {
      tripwireLogger.warn(
        {
          projectId,
          table,
          divergenceCount: divergences.length,
          // Cap the structured payload so a fully-divergent rollup query
          // doesn't dump megabytes of log lines.
          divergences: divergences.slice(0, 10),
        },
        "ADR-034 tripwire: routed analytics result diverged from legacy trace_summaries result",
      );
    }
  } catch (error) {
    // Tripwire must never break the read.
    tripwireLogger.warn(
      {
        projectId,
        table,
        error: error instanceof Error ? error.message : String(error),
      },
      "ADR-034 tripwire: failed to compare routed and legacy results",
    );
  }
}
