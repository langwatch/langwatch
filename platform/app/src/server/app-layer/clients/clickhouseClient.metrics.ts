import type {
  CounterHandle,
  HistogramHandle,
  Metrics,
} from "@langwatch/clickhouse";
import { Counter, Histogram, register } from "prom-client";

/**
 * Wires the new ClickHouse client's `Metrics` port (ADR-104 §8) onto the
 * app's existing prom-client registry, so `clickhouse_operation_*` and
 * `clickhouse_bulkhead_wait_seconds` are served at the same `/metrics`
 * endpoint as everything else rather than sitting unregistered.
 *
 * The port's `counter`/`histogram` calls carry only a name and help text — no
 * `labelNames` — so the label sets below are declared once, by hand, matching
 * exactly what `createClickHouseClient` passes at each call site. Distinct
 * names from the legacy client's `clickhouse_query_*` metrics
 * (`~/server/clickhouse/metrics.ts`), so the two can run side by side during
 * the migration without colliding in the registry.
 */
const OPERATION_LABELS = ["operation", "table", "outcome"] as const;

for (const name of [
  "clickhouse_operation_duration_seconds",
  "clickhouse_operation_total",
  "clickhouse_bulkhead_wait_seconds",
]) {
  register.removeSingleMetric(name);
}

const operationDuration = new Histogram({
  name: "clickhouse_operation_duration_seconds",
  help: "Duration of a new ClickHouse client operation, labelled by operation, table and outcome (ADR-104).",
  labelNames: OPERATION_LABELS,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

const operationTotal = new Counter({
  name: "clickhouse_operation_total",
  help: "Count of new ClickHouse client operations, labelled by operation, table and outcome (ADR-104).",
  labelNames: OPERATION_LABELS,
});

const bulkheadWaitSeconds = new Histogram({
  name: "clickhouse_bulkhead_wait_seconds",
  help: "Time an operation spent queued behind the new client's per-tenant concurrency bulkhead (ADR-104 §4).",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const registeredMetrics: Record<
  string,
  typeof operationDuration | typeof operationTotal | typeof bulkheadWaitSeconds
> = {
  clickhouse_operation_duration_seconds: operationDuration,
  clickhouse_operation_total: operationTotal,
  clickhouse_bulkhead_wait_seconds: bulkheadWaitSeconds,
};

export const clickhouseClientMetrics: Metrics = {
  counter(spec): CounterHandle {
    const metric = registeredMetrics[spec.name];
    if (!(metric instanceof Counter)) {
      throw new Error(
        `clickhouseClientMetrics: "${spec.name}" is not a registered counter`,
      );
    }
    return {
      inc: (labels, value = 1) => metric.inc(labels ?? {}, value),
    };
  },

  histogram(spec): HistogramHandle {
    const metric = registeredMetrics[spec.name];
    if (!(metric instanceof Histogram)) {
      throw new Error(
        `clickhouseClientMetrics: "${spec.name}" is not a registered histogram`,
      );
    }
    return {
      observe: (value, labels) => metric.observe(labels ?? {}, value),
    };
  },
};
