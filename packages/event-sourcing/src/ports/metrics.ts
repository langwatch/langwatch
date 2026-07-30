/**
 * Metrics is the one observability signal that stays a port.
 *
 * Logging comes from `@langwatch/observability` (`createLogger`), and tracing
 * from the OpenTelemetry API, because both are house packages with a settled
 * interface. There is no metrics package — the application registers
 * prom-client collectors against its own registry — so the package declares the
 * shape it needs and the composition root supplies it.
 *
 * The port stays deliberately small. Anything richer (exemplars, native
 * histograms, per-registry wiring) belongs to whichever implementation the
 * application chooses, not to the contract between them.
 */

export type MetricLabels = Readonly<Record<string, string>>;

export interface MetricSpec {
  /** Stable metric name, e.g. `es_fold_apply_total`. */
  readonly name: string;
  /** One sentence, shown in metric catalogues. */
  readonly help: string;
  /**
   * The label names this metric may carry. Declared up front because a label
   * set that varies per call site is how a cardinality explosion starts.
   */
  readonly labelNames?: readonly string[];
}

export interface HistogramSpec extends MetricSpec {
  readonly buckets?: readonly number[];
}

export interface CounterHandle {
  inc(labels?: MetricLabels, value?: number): void;
}

export interface HistogramHandle {
  observe(value: number, labels?: MetricLabels): void;
}

/**
 * Handles are resolved once, at construction — registering a collector on every
 * observation turns a metrics registry into a hot-path allocation.
 */
export interface Metrics {
  counter(spec: MetricSpec): CounterHandle;
  histogram(spec: HistogramSpec): HistogramHandle;
}

/**
 * A metrics implementation that records nothing.
 *
 * Present so an unwired component still runs. The alternative is an optional
 * parameter, and an optional telemetry parameter is one that some call site
 * eventually forgets — a silent gap in a dashboard rather than a failure.
 */
export const noopMetrics: Metrics = {
  counter: () => ({ inc: () => undefined }),
  histogram: () => ({ observe: () => undefined }),
};
