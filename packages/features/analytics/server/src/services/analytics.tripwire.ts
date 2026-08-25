import { createLogger } from "@langwatch/observability";
import type { AnalyticsTimeseriesResult } from "@langwatch/analytics-contract";
import { AnalyticsTripwire } from "@langwatch/analytics-contract";

const tolerance = 0.001;
const logger = createLogger("langwatch:analytics:tripwire");

export class LoggingAnalyticsTripwire extends AnalyticsTripwire {
  static create(options: {
    isEnabled: (projectId: string) => Promise<boolean>;
  }): LoggingAnalyticsTripwire {
    return new LoggingAnalyticsTripwire(options.isEnabled);
  }

  private constructor(private readonly enabled: (projectId: string) => Promise<boolean>) {
    super();
  }

  isEnabled(projectId: string): Promise<boolean> {
    return this.enabled(projectId);
  }

  compare(input: {
    projectId: string;
    table: string;
    routed: AnalyticsTimeseriesResult;
    legacy: AnalyticsTimeseriesResult;
  }): void {
    try {
      const divergences: Array<{
        period: string;
        date: string;
        metric: string;
        routed: number | null;
        legacy: number | null;
      }> = [];
      for (const period of ["current", "previous"] as const) {
        const routed =
          period === "current" ? input.routed.currentPeriod : input.routed.previousPeriod;
        const legacy =
          period === "current" ? input.legacy.currentPeriod : input.legacy.previousPeriod;
        const routedByDate = new Map(routed.map((bucket) => [bucket.date, bucket]));
        const legacyByDate = new Map(legacy.map((bucket) => [bucket.date, bucket]));
        for (const date of new Set([...routedByDate.keys(), ...legacyByDate.keys()])) {
          const routedBucket = routedByDate.get(date);
          const legacyBucket = legacyByDate.get(date);
          if (!routedBucket || !legacyBucket) {
            divergences.push({
              period,
              date,
              metric: "*",
              routed: routedBucket ? 1 : null,
              legacy: legacyBucket ? 1 : null,
            });
            continue;
          }
          const routedMetrics = flatten(routedBucket);
          const legacyMetrics = flatten(legacyBucket);
          for (const metric of new Set([
            ...routedMetrics.keys(),
            ...legacyMetrics.keys(),
          ])) {
            const routedValue = routedMetrics.get(metric);
            const legacyValue = legacyMetrics.get(metric);
            if (routedValue === undefined || legacyValue === undefined) {
              divergences.push({
                period,
                date,
                metric,
                routed: routedValue ?? null,
                legacy: legacyValue ?? null,
              });
              continue;
            }
            const denominator = Math.max(Math.abs(routedValue), Math.abs(legacyValue));
            if (
              denominator > 0 &&
              Math.abs(routedValue - legacyValue) / denominator > tolerance
            ) {
              divergences.push({
                period,
                date,
                metric,
                routed: routedValue,
                legacy: legacyValue,
              });
            }
          }
        }
      }
      if (divergences.length > 0) {
        logger.warn(
          {
            projectId: input.projectId,
            table: input.table,
            divergenceCount: divergences.length,
            divergences: divergences.slice(0, 10),
          },
          "ADR-034 tripwire: routed analytics result diverged from legacy",
        );
      }
    } catch (error) {
      logger.warn(
        {
          projectId: input.projectId,
          table: input.table,
          error: error instanceof Error ? error.message : String(error),
        },
        "ADR-034 tripwire: failed to compare routed and legacy results",
      );
    }
  }
}

function flatten(bucket: Record<string, unknown>): Map<string, number> {
  const result = new Map<string, number>();
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "number") {
      result.set(path, value);
      return;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, nested] of Object.entries(value))
      visit(nested, path ? `${path}.${key}` : key);
  };
  for (const [key, value] of Object.entries(bucket))
    if (key !== "date") visit(value, key);
  return result;
}
