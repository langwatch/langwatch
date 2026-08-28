/**
 * The facade's own contract: late meter resolution, boundary enforcement, and
 * observable gauges that survive being declared before boot.
 *
 * A hand-written meter stands in for the SDK rather than a real
 * MeterProvider — the SDK's aggregation is not ours to test, and the three
 * behaviours below are exactly the ones that fail silently in production.
 */
import { metrics, type Attributes } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HISTOGRAM_BOUNDARIES } from "../histogram-boundaries";
import {
  activateMetrics,
  counter,
  gauge,
  histogram,
  observableGauge,
  resetMetricsForTests,
} from "../instruments";

interface Recorded {
  readonly instrument: string;
  readonly value: number;
  readonly attributes: Attributes | undefined;
}

/** Collects every value written through it, in order. */
function createRecordingMeterProvider() {
  const recorded: Recorded[] = [];
  const observableCallbacks: Array<(result: { observe: (v: number, a?: Attributes) => void }) => unknown> = [];

  const write = (instrument: string) => ({
    add: (value: number, attributes?: Attributes) => {
      recorded.push({ instrument, value, attributes });
    },
    record: (value: number, attributes?: Attributes) => {
      recorded.push({ instrument, value, attributes });
    },
  });

  const meter = {
    createCounter: (name: string) => write(name),
    createHistogram: (name: string) => write(name),
    createGauge: (name: string) => write(name),
    createUpDownCounter: (name: string) => write(name),
    createObservableGauge: (name: string) => ({
      addCallback: (callback: (result: { observe: (v: number, a?: Attributes) => void }) => unknown) => {
        observableCallbacks.push(async (result) => await callback(result));
      },
      removeCallback: () => void 0,
    }),
    createObservableCounter: (name: string) => ({ addCallback: () => void 0, removeCallback: () => void 0 }),
    createObservableUpDownCounter: (name: string) => ({ addCallback: () => void 0, removeCallback: () => void 0 }),
    addBatchObservableCallback: () => void 0,
    removeBatchObservableCallback: () => void 0,
  };

  /** Runs every observable callback, the way an export interval would. */
  const collect = async (instrument: string) => {
    for (const callback of observableCallbacks) {
      await callback({
        observe: (value, attributes) => recorded.push({ instrument, value, attributes }),
      });
    }
  };

  return {
    recorded,
    collect,
    observableCount: () => observableCallbacks.length,
    provider: { getMeter: () => meter } as unknown as Parameters<typeof metrics.setGlobalMeterProvider>[0],
  };
}

describe("metric instruments", () => {
  let harness: ReturnType<typeof createRecordingMeterProvider>;

  beforeEach(() => {
    resetMetricsForTests();
    metrics.disable();
    harness = createRecordingMeterProvider();
  });

  afterEach(() => {
    metrics.disable();
    resetMetricsForTests();
  });

  describe("given an instrument declared before a provider is registered", () => {
    it("records into the provider registered afterwards", () => {
      const jobs = counter({ name: "job_processing_counter", description: "Jobs processed" });

      metrics.setGlobalMeterProvider(harness.provider);
      activateMetrics();
      jobs.inc({ job_type: "trace" });

      expect(harness.recorded).toEqual([
        { instrument: "job_processing_counter", value: 1, attributes: { job_type: "trace" } },
      ]);
    });

    it("stops writing to a provider that has been replaced", () => {
      const jobs = counter({ name: "job_processing_counter", description: "Jobs processed" });

      metrics.setGlobalMeterProvider(harness.provider);
      activateMetrics();
      jobs.inc();

      const replacement = createRecordingMeterProvider();
      metrics.disable();
      metrics.setGlobalMeterProvider(replacement.provider);
      activateMetrics();
      jobs.inc();

      expect(harness.recorded).toHaveLength(1);
      expect(replacement.recorded).toHaveLength(1);
    });
  });

  describe("when a counter is incremented", () => {
    beforeEach(() => {
      metrics.setGlobalMeterProvider(harness.provider);
      activateMetrics();
    });

    it("adds one by default", () => {
      counter({ name: "pii_checks", description: "PII checks" }).inc();
      expect(harness.recorded[0]?.value).toBe(1);
    });

    it("adds the value it is given", () => {
      counter({ name: "pii_checks", description: "PII checks" }).inc({ method: "presidio" }, 7);
      expect(harness.recorded[0]).toEqual({
        instrument: "pii_checks",
        value: 7,
        attributes: { method: "presidio" },
      });
    });
  });

  describe("when a histogram is declared", () => {
    it("refuses a name with no bucket boundaries", () => {
      expect(() =>
        histogram({ name: "not_in_the_manifest_milliseconds", description: "…" }),
      ).toThrowError(/HISTOGRAM_BOUNDARIES/);
    });

    it("accepts every name the manifest carries", () => {
      for (const name of Object.keys(HISTOGRAM_BOUNDARIES)) {
        expect(() => histogram({ name, description: "…" })).not.toThrow();
      }
    });

    it("observes the value it is given", () => {
      metrics.setGlobalMeterProvider(harness.provider);
      activateMetrics();
      histogram({ name: "trace_span_count", description: "Spans" }).observe(42);
      expect(harness.recorded[0]).toEqual({
        instrument: "trace_span_count",
        value: 42,
        attributes: void 0,
      });
    });
  });

  describe("when a gauge is set", () => {
    it("records the last value written", () => {
      metrics.setGlobalMeterProvider(harness.provider);
      activateMetrics();
      const active = gauge({ name: "gq_active_groups", description: "Active groups" });
      active.set(3, { queue: "traces" });
      active.set(5, { queue: "traces" });
      expect(harness.recorded.map((r) => r.value)).toEqual([3, 5]);
    });
  });

  describe("given an observable gauge declared before activation", () => {
    it("is not registered until a provider exists", () => {
      observableGauge({ name: "pm_instances", description: "Process instances" }, (observer) => {
        observer.observe(2, { process_name: "billing" });
      });

      metrics.setGlobalMeterProvider(harness.provider);
      expect(harness.observableCount()).toBe(0);

      activateMetrics();
      expect(harness.observableCount()).toBe(1);
    });

    it("reports on collection, awaiting an async read", async () => {
      observableGauge({ name: "pm_outbox_pending", description: "Pending outbox rows" }, async (observer) => {
        await Promise.resolve();
        observer.observe(11, { process_name: "billing" });
      });

      metrics.setGlobalMeterProvider(harness.provider);
      activateMetrics();
      await harness.collect("pm_outbox_pending");

      expect(harness.recorded).toEqual([
        { instrument: "pm_outbox_pending", value: 11, attributes: { process_name: "billing" } },
      ]);
    });
  });

  describe("given an observable gauge declared after activation", () => {
    it("registers immediately", () => {
      metrics.setGlobalMeterProvider(harness.provider);
      activateMetrics();

      observableGauge({ name: "pm_instances", description: "Process instances" }, (observer) => {
        observer.observe(1);
      });

      expect(harness.observableCount()).toBe(1);
    });
  });
});
