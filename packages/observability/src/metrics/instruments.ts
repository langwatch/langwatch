/**
 * The process's metric instruments, recorded through the OpenTelemetry API and
 * pushed to a collector — no scrape endpoint, no `prom-client` registry.
 *
 * ## Why a facade rather than `meter.createCounter` at each call site
 *
 * Three properties are easy to get wrong once and then never notice, because
 * every one of them fails by producing *no* data rather than an error:
 *
 * 1. **The meter must be resolved late.** `metrics.getMeter()` has no proxy
 *    that upgrades: unlike `trace.getTracer()`, a meter obtained before
 *    `setGlobalMeterProvider` is a no-op meter *forever*. Instruments are
 *    declared at module scope all over this repo, which is frequently before
 *    boot has registered the provider. So a handle here holds only its
 *    definition, and creates the real instrument on first record.
 * 2. **Histogram boundaries live on the provider, not the instrument.** They
 *    come from `HISTOGRAM_BOUNDARIES`, and a histogram with no entry throws
 *    on declaration rather than silently taking OTel's generic 0…10000
 *    buckets.
 * 3. **Names must survive the transport change.** They are the Prometheus
 *    names these metrics have always had, and dashboards and alerts read them
 *    by name. Nothing here appends a suffix, and no instrument declares a
 *    `unit` — the unit is already the last word of the name (`_milliseconds`,
 *    `_bytes`, `_seconds`), and an OTel unit would be appended a second time
 *    by a collector exporting to Prometheus with `add_metric_suffixes` on.
 *
 * ## Deployment requirement
 *
 * The collector's Prometheus exporter must run with `add_metric_suffixes:
 * false`. With it on, every counter gains a `_total` it does not have today
 * (`job_processing_counter` becomes `job_processing_counter_total`) and every
 * dashboard panel and alert that names one goes empty — the same silent
 * "everything is fine" failure as the missing-`_total` incident. This is the
 * one setting the migration depends on and it lives outside this repo.
 */
import {
  metrics,
  type Attributes,
  type Counter,
  type Gauge,
  type Histogram,
  type Meter,
} from "@opentelemetry/api";
import { HISTOGRAM_BOUNDARIES } from "./histogram-boundaries";

/**
 * The instrumentation scope every LangWatch instrument is created under.
 * One scope, so a collector or backend can select everything this platform
 * emits about itself without matching on metric names.
 */
export const METRICS_SCOPE_NAME = "langwatch";

/**
 * Bumped by `activateMetrics` and `resetMetricsForTests`. Every cached meter
 * and instrument records the generation it was built in and rebuilds when it
 * falls behind, which is what lets an instrument created before the provider
 * was registered start reporting once it is.
 */
let generation = 0;
let meter: { value: Meter; generation: number } | undefined;

/** Observable gauges declared before a provider existed, awaiting activation. */
const pendingObservations: Array<() => void> = [];
let activated = false;

function currentMeter(): Meter {
  if (!meter || meter.generation !== generation) {
    meter = { value: metrics.getMeter(METRICS_SCOPE_NAME), generation };
  }
  return meter.value;
}

/**
 * Point the facade at the MeterProvider that was just registered globally.
 *
 * Call this immediately after `metrics.setGlobalMeterProvider(...)` in a
 * process's boot path. It installs every observable gauge that was declared
 * while no provider existed, and invalidates any instrument that was created
 * against the no-op meter.
 *
 * Recording works without it — a synchronous instrument resolves its meter on
 * first use, which is normally well after boot. Observable gauges do not: they
 * are pull-based, have no first use, and must be registered with a real meter
 * to ever be collected. That is what this call exists for.
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
 * A gauge read on the export interval rather than written when it changes.
 *
 * This replaces `prom-client`'s `collect()`, with one difference worth
 * knowing: `collect()` ran per scrape, so its cost scaled with the number of
 * scrapers and its cadence was whatever Prometheus was configured with.
 * `observe` runs once per export interval regardless of who is watching, so a
 * read that queries a database now happens on a fixed, known schedule.
 *
 * `observe` may be async; the SDK awaits it before exporting the batch. It
 * must report every series it wants present in that interval — a series it
 * skips is simply absent, not carried forward.
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
