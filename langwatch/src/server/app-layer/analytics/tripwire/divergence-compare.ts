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

import { createLogger } from "@langwatch/observability";
import type { TimeseriesBucket, TimeseriesResult } from "~/server/analytics/types";
import type { AnalyticsTable } from "../routing/route-table";

/**
 * Numeric tolerance (fraction of max(|routed|, |legacy|)) below which the
 * tripwire considers a bucket pair equivalent. 0.1% — wide enough to absorb
 * float rounding + tiny re-delivery double-counts the rollup explicitly
 * accepts (ADR-034), tight enough to flag systematic drift.
 */
const TRIPWIRE_NUMERIC_TOLERANCE = 0.001 as const;

/**
 * Stop accumulating divergence records past this many. A fully-divergent
 * grouped query can produce one record per (date × group key × metric); the
 * count keeps rising but the array stops growing.
 */
const MAX_COLLECTED_DIVERGENCES = 100 as const;

const tripwireLogger = createLogger("langwatch:analytics:tripwire");

export interface CompareForTripwireInput {
  projectId: string;
  table: AnalyticsTable;
  routed: TimeseriesResult;
  legacy: TimeseriesResult;
}

type DivergenceKind = "value" | "missing-bucket" | "missing-metric";

interface Divergence {
  kind: DivergenceKind;
  period: "current" | "previous";
  date: string;
  metric: string;
  routed: number | null;
  legacy: number | null;
  relativeDelta: number | null;
}

/**
 * Flatten a bucket to `metricPath -> number`.
 *
 * An ungrouped bucket is `{ date, "0/…": 12.3 }` — one level. A GROUPED bucket
 * nests two more: `{ date, "metadata.model": { "gpt-4": { "0/…": 12.3 } } }`.
 * The old comparator tested `typeof value === "number"` at the top level only,
 * so every grouped query — the riskiest routed shapes, and the ones whose
 * attribution semantics differ per table — compared nothing at all and could
 * never trip. Recursing gives `metadata.model.gpt-4.0/…` as a comparable path.
 */
function flattenBucketMetrics(bucket: TimeseriesBucket): Map<string, number> {
  const flat = new Map<string, number>();

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "number") {
      flat.set(path, value);
      return;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      // Strings (group labels) and arrays carry no numeric signal.
      return;
    }
    for (const [key, inner] of Object.entries(value)) {
      walk(inner, path === "" ? key : `${path}.${key}`);
    }
  };

  for (const [key, value] of Object.entries(bucket)) {
    if (key === "date") continue;
    walk(value, key);
  }
  return flat;
}

export function compareForTripwire(input: CompareForTripwireInput): void {
  const { projectId, table, routed, legacy } = input;
  try {
    const divergences: Divergence[] = [];
    let divergenceCount = 0;

    const record = (d: Divergence): void => {
      divergenceCount++;
      if (divergences.length < MAX_COLLECTED_DIVERGENCES) divergences.push(d);
    };

    for (const period of ["current", "previous"] as const) {
      const routedBuckets =
        period === "current" ? routed.currentPeriod : routed.previousPeriod;
      const legacyBuckets =
        period === "current" ? legacy.currentPeriod : legacy.previousPeriod;

      const routedByDate = new Map(routedBuckets.map((b) => [b.date, b]));
      const legacyByDate = new Map(legacyBuckets.map((b) => [b.date, b]));

      // A bucket present on one side and absent on the other is a divergence in
      // its own right — a routed query that drops a whole date (or invents one)
      // is exactly the failure the tripwire exists to catch, and the old
      // `if (!l) continue` silently tolerated it.
      const allDates = new Set([...routedByDate.keys(), ...legacyByDate.keys()]);

      for (const date of allDates) {
        const r = routedByDate.get(date);
        const l = legacyByDate.get(date);
        if (!r || !l) {
          record({
            kind: "missing-bucket",
            period,
            date,
            metric: "*",
            routed: r ? 1 : null,
            legacy: l ? 1 : null,
            relativeDelta: null,
          });
          continue;
        }

        const routedFlat = flattenBucketMetrics(r);
        const legacyFlat = flattenBucketMetrics(l);
        const allMetrics = new Set([...routedFlat.keys(), ...legacyFlat.keys()]);

        for (const metric of allMetrics) {
          const rv = routedFlat.get(metric);
          const lv = legacyFlat.get(metric);

          // A group key that exists on one side only (e.g. a model bucket the
          // routed table attributes differently) shows up here as a metric
          // path missing from the other map.
          if (rv === undefined || lv === undefined) {
            record({
              kind: "missing-metric",
              period,
              date,
              metric,
              routed: rv ?? null,
              legacy: lv ?? null,
              relativeDelta: null,
            });
            continue;
          }

          const denom = Math.max(Math.abs(rv), Math.abs(lv));
          if (denom === 0) continue;
          const delta = Math.abs(rv - lv) / denom;
          if (delta > TRIPWIRE_NUMERIC_TOLERANCE) {
            record({
              kind: "value",
              period,
              date,
              metric,
              routed: rv,
              legacy: lv,
              relativeDelta: delta,
            });
          }
        }
      }
    }

    if (divergenceCount > 0) {
      tripwireLogger.warn(
        {
          projectId,
          table,
          divergenceCount,
          // Cap the structured payload so a fully-divergent grouped query
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
