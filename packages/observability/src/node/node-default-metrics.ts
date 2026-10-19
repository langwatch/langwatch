/**
 * Node's default collectors (heap, GC, event loop, handles) on prom-client's default registry, as
 * main had them, and that registry's families beside the OTel reader's on the scrape door.
 * Spec: specs/server/api-process-metrics.feature.
 */
import { collectDefaultMetrics, register } from "prom-client";

import type { PrometheusExposition } from "./prometheus-metrics-door.ts";

/** The collector main probed for; present means another composition already installed them. */
const DEFAULT_COLLECTOR_PROBE = "process_cpu_user_seconds_total";

/** Once per process: the registry refuses a collector registered twice. */
export function installNodeDefaultMetrics(): void {
  if (register.getSingleMetric(DEFAULT_COLLECTOR_PROBE) !== undefined) return;
  collectDefaultMetrics({ register });
}

/** The OTel exposition, then every registry family it does not already name (one TYPE per name). */
export async function withRegistryFamilies(
  exposition: PrometheusExposition,
): Promise<PrometheusExposition> {
  const named = new Set(
    [...exposition.body.matchAll(/^# TYPE (\S+) /gm)].map((match) => match[1] ?? ""),
  );
  const families = await Promise.all(
    register
      .getMetricsAsArray()
      .filter((metric) => !named.has(metric.name))
      .map((metric) => register.getSingleMetricAsString(metric.name)),
  );
  const extra = families.filter((family) => family.trim() !== "").map((family) => family.trimEnd());
  if (extra.length === 0) return exposition;
  return { ...exposition, body: `${exposition.body}${extra.join("\n")}\n` };
}
