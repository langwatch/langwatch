/**
 * Node-only metric instruments, pushed over OTLP.
 *
 * Kept off the package's browser-safe root export: nothing in a browser
 * bundle records platform metrics, and the boundary map is dead weight there.
 */
export {
  HISTOGRAM_BOUNDARIES,
  metricHistogramViews,
  type HistogramViewDescriptor,
} from "./histogram-boundaries";
export {
  METRICS_SCOPE_NAME,
  activateMetrics,
  counter,
  gauge,
  histogram,
  observableGauge,
  resetMetricsForTests,
  type CounterHandle,
  type GaugeHandle,
  type GaugeObserver,
  type HistogramHandle,
  type MetricDefinition,
} from "./instruments";
