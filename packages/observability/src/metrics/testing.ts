/**
 * A MeterProvider that records what instruments write, for tests.
 *
 * Stands in for the metrics SDK rather than wrapping it: aggregation and
 * export are OpenTelemetry's to get right, and what a test of our code needs
 * to know is "which instrument was written, with what value and which
 * attributes". Reading that from a real `PeriodicExportingMetricReader` means
 * awaiting a collection cycle and walking a `ResourceMetrics` tree to assert
 * one number.
 *
 * ```ts
 * const metrics = createRecordingMeterProvider();
 * metrics.install();
 * // …exercise the code…
 * expect(metrics.valueOf("coding_agent_cost_reported_usd_total")).toBe(1);
 * metrics.uninstall();
 * ```
 */
import { metrics as metricsApi, type Attributes } from "@opentelemetry/api";
import { activateMetrics, resetMetricsForTests } from "./instruments";

/** One value written to one instrument. */
export interface RecordedMetric {
  readonly instrument: string;
  readonly value: number;
  readonly attributes: Attributes;
}

export interface RecordingMeterProvider {
  /** Every write, in order. */
  readonly recorded: readonly RecordedMetric[];
  /** Registers globally and activates the facade against it. */
  install(): void;
  /** Unregisters and clears the facade's caches. */
  uninstall(): void;
  /** Runs every observable-gauge callback, as an export interval would. */
  collect(): Promise<void>;
  /**
   * The sum of everything written to `instrument`, optionally narrowed to the
   * series matching `attributes`. Counters read as their total; a gauge or
   * histogram is usually better read through `valuesOf`.
   */
  valueOf(instrument: string, attributes?: Attributes): number;
  /** Every value written to `instrument`, in order. */
  valuesOf(instrument: string, attributes?: Attributes): number[];
}

function matches(recorded: Attributes, expected: Attributes | undefined): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(([key, value]) => recorded[key] === value);
}

export function createRecordingMeterProvider(): RecordingMeterProvider {
  const recorded: RecordedMetric[] = [];
  const observables: Array<{
    instrument: string;
    callback: (result: { observe: (value: number, attributes?: Attributes) => void }) => unknown;
  }> = [];

  const writer = (instrument: string) => {
    const push = (value: number, attributes?: Attributes) => {
      recorded.push({ instrument, value, attributes: attributes ?? {} });
    };
    return { add: push, record: push };
  };

  const observable = (instrument: string) => ({
    addCallback: (callback: (result: { observe: (v: number, a?: Attributes) => void }) => unknown) => {
      observables.push({ instrument, callback });
    },
    removeCallback: () => void 0,
  });

  const meter = {
    createCounter: writer,
    createUpDownCounter: writer,
    createHistogram: writer,
    createGauge: writer,
    createObservableGauge: observable,
    createObservableCounter: observable,
    createObservableUpDownCounter: observable,
    addBatchObservableCallback: () => void 0,
    removeBatchObservableCallback: () => void 0,
  };

  const provider = { getMeter: () => meter } as unknown as Parameters<
    typeof metricsApi.setGlobalMeterProvider
  >[0];

  const select = (instrument: string, attributes?: Attributes) =>
    recorded.filter((r) => r.instrument === instrument && matches(r.attributes, attributes));

  return {
    recorded,
    install() {
      // A previous test's provider would otherwise win: the metrics API
      // ignores a second `setGlobalMeterProvider` without a `disable()` first.
      metricsApi.disable();
      metricsApi.setGlobalMeterProvider(provider);
      activateMetrics();
    },
    uninstall() {
      metricsApi.disable();
      resetMetricsForTests();
    },
    async collect() {
      for (const { instrument, callback } of observables) {
        await callback({
          observe: (value, attributes) => {
            recorded.push({ instrument, value, attributes: attributes ?? {} });
          },
        });
      }
    },
    valueOf(instrument, attributes) {
      return select(instrument, attributes).reduce((total, r) => total + r.value, 0);
    },
    valuesOf(instrument, attributes) {
      return select(instrument, attributes).map((r) => r.value);
    },
  };
}
