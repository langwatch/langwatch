/**
 * Metric instruments recorded through OpenTelemetry API: a facade that resolves
 * the meter late and enforces histogram boundaries.
 */
import {
  metrics,
  type Attributes,
  type Counter,
  type Gauge,
  type Histogram,
  type Meter,
} from "@opentelemetry/api";

import { HISTOGRAM_BOUNDARIES } from "./histogram-boundaries.ts";

/**
 * The instrumentation scope every LangWatch instrument is created under.
 * One scope, so a collector or backend can select everything this platform
 * emits about itself without matching on metric names.
 */
export const METRICS_SCOPE_NAME = "langwatch";

/**
 * Bumped by `activateMetrics` and `resetMetricsForTests`. Every cached
 * meter/instrument records its build generation and rebuilds when it falls
 * behind — letting one created before the provider registers start reporting once it does.
 */
let generation = 0;
let meter: { value: Meter; generation: number } | undefined;

/** Observable gauges declared before a provider existed, awaiting activation. */
const pendingObservations: (() => void)[] = [];
let activated = false;

function currentMeter(): Meter {
  if (!meter || meter.generation !== generation) {
    meter = { value: metrics.getMeter(METRICS_SCOPE_NAME), generation };
  }
  return meter.value;
}

/**
 * Point the facade at the MeterProvider registered globally: installs
 * observable gauges declared before boot.
 */
export function activateMetrics(): void {
  generation += 1;
  activated = true;
  const pending = pendingObservations.splice(0, pendingObservations.length);
  for (const install of pending) install();
}

/**
 * Drop every cached meter and instrument. For tests that install their own
 * MeterProvider — without this they would keep recording into the previous
 * one, and the assertions would read an empty reader.
 */
export function resetMetricsForTests(): void {
  generation += 1;
  meter = void 0;
  activated = false;
  pendingObservations.length = 0;
}

/** What every instrument declaration carries. */
export interface MetricDefinition {
  /**
   * The Prometheus name, unchanged: lower_snake_case, with the unit as the
   * last word where there is one. Never a dotted OTel-style name — these are
   * read by existing dashboards and alerts.
   */
  readonly name: string;
  /** One line, shown as the metric's HELP text wherever it lands. */
  readonly description: string;
}

/** A monotonically increasing count. */
export interface CounterHandle {
  /** Adds `value` (default 1) to the series for `attributes`. */
  inc(attributes?: Attributes, value?: number): void;
}

/** A distribution, bucketed by `HISTOGRAM_BOUNDARIES[name]`. */
export interface HistogramHandle {
  observe(value: number, attributes?: Attributes): void;
}

/** A value that goes up and down, written when it changes. */
export interface GaugeHandle {
  set(value: number, attributes?: Attributes): void;
}

/** Reports one observation of an observable gauge. */
export interface GaugeObserver {
  observe(value: number, attributes?: Attributes): void;
}

export function counter(definition: MetricDefinition): CounterHandle {
  let instrument: { value: Counter; generation: number } | undefined;
  return {
    inc(attributes, value = 1) {
      if (!instrument || instrument.generation !== generation) {
        instrument = {
          value: currentMeter().createCounter(definition.name, {
            description: definition.description,
          }),
          generation,
        };
      }
      instrument.value.add(value, attributes);
    },
  };
}

export function histogram(definition: MetricDefinition): HistogramHandle {
  // Declaration-time, deliberately: a histogram with no boundaries would
  // report happily and quantile wrongly, and the only symptom would be a chart
  // that looks plausible. Throwing here fails the process that declares it.
  if (!(definition.name in HISTOGRAM_BOUNDARIES)) {
    throw new Error(
      `Histogram "${definition.name}" has no entry in HISTOGRAM_BOUNDARIES. ` +
        "Add its bucket boundaries there — they cannot be declared on the instrument, " +
        "because OpenTelemetry configures them on the MeterProvider through a View.",
    );
  }

  let instrument: { value: Histogram; generation: number } | undefined;
  return {
    observe(value, attributes) {
      if (!instrument || instrument.generation !== generation) {
        instrument = {
          value: currentMeter().createHistogram(definition.name, {
            description: definition.description,
          }),
          generation,
        };
      }
      instrument.value.record(value, attributes);
    },
  };
}

export function gauge(definition: MetricDefinition): GaugeHandle {
  let instrument: { value: Gauge; generation: number } | undefined;
  return {
    set(value, attributes) {
      if (!instrument || instrument.generation !== generation) {
        instrument = {
          value: currentMeter().createGauge(definition.name, {
            description: definition.description,
          }),
          generation,
        };
      }
      instrument.value.record(value, attributes);
    },
  };
}

/**
 * A gauge read on the export interval: `observe` may be async and must report
 * every series for that interval.
 */
export function observableGauge(
  definition: MetricDefinition,
  observe: (observer: GaugeObserver) => void | Promise<void>,
): void {
  const install = () => {
    const instrument = currentMeter().createObservableGauge(definition.name, {
      description: definition.description,
    });
    instrument.addCallback(async (result) => {
      await observe({
        observe: (value, attributes) => result.observe(value, attributes),
      });
    });
  };

  // Before activation there is no provider, so registering now would attach
  // the callback to a no-op meter that is never collected — the pull-based
  // equivalent of the stale-meter trap this facade exists to avoid.
  if (activated) install();
  else pendingObservations.push(install);
}
