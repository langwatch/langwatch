import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Import all new metric functions to verify they exist and are callable
import {
  incrementEsCommandTotal,
  incrementEsFoldCacheRedisError,
  incrementEsFoldCacheTotal,
  incrementEsFoldPostStoreFailure,
  incrementEsFoldProjectionTotal,
  incrementEsMapProjectionTotal,
  incrementEsProcessManagerTotal,
  incrementEsProcessOutboxTotal,
  incrementEsProjectionTotal,
  incrementEsProjectionSubscriberTotal,
  incrementEsSubscriberTotal,
  observeEsCommandDuration,
  observeEsFoldCacheGetDuration,
  observeEsFoldCacheStoreDuration,
  observeEsFoldProjectionDuration,
  observeEsMapProjectionDuration,
  observeEsProcessManagerDuration,
  observeEsProcessOutboxDuration,
  observeEsProjectionDuration,
  observeEsProjectionSubscriberDuration,
  observeEsSubscriberDuration,
  withMetrics,
} from "../metrics.ts";

describe("ES pipeline metrics", () => {
  let meter = createRecordingMeterProvider();
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
  });
  afterEach(() => meter.uninstall());

  describe("when a series is recorded", () => {
    /** @scenario "Eventing series are recorded through the metrics facade" */
    it.each([
      ["es_command_total", () => incrementEsCommandTotal("p", "StartRun", "completed")],
      ["es_command_duration_milliseconds", () => observeEsCommandDuration("p", "StartRun", 1)],
      [
        "es_fold_projection_total",
        () =>
          incrementEsFoldProjectionTotal({
            pipelineName: "p",
            projectionName: "x",
            status: "completed",
          }),
      ],
      [
        "es_fold_projection_duration_milliseconds",
        () =>
          observeEsFoldProjectionDuration({
            pipelineName: "p",
            projectionName: "x",
            durationMs: 1,
          }),
      ],
      [
        "es_map_projection_total",
        () =>
          incrementEsMapProjectionTotal({
            pipelineName: "p",
            projectionName: "x",
            status: "completed",
          }),
      ],
      [
        "es_map_projection_duration_milliseconds",
        () =>
          observeEsMapProjectionDuration({ pipelineName: "p", projectionName: "x", durationMs: 1 }),
      ],
      [
        "es_projection_total",
        () =>
          incrementEsProjectionTotal({
            pipelineName: "p",
            projectionKind: "fold",
            projectionName: "x",
            status: "completed",
          }),
      ],
      [
        "es_projection_duration_milliseconds",
        () =>
          observeEsProjectionDuration({
            pipelineName: "p",
            projectionKind: "fold",
            projectionName: "x",
            durationMs: 1,
          }),
      ],
      [
        "es_subscriber_total",
        () =>
          incrementEsSubscriberTotal({
            pipelineName: "p",
            subscriberName: "s",
            status: "completed",
          }),
      ],
      [
        "es_subscriber_duration_milliseconds",
        () =>
          observeEsSubscriberDuration({ pipelineName: "p", subscriberName: "s", durationMs: 1 }),
      ],
      [
        "es_process_manager_total",
        () =>
          incrementEsProcessManagerTotal({
            processName: "p",
            inputKind: "event",
            outcome: "committed",
          }),
      ],
      [
        "es_process_manager_duration_milliseconds",
        () =>
          observeEsProcessManagerDuration({ processName: "p", inputKind: "event", durationMs: 1 }),
      ],
      [
        "es_process_outbox_total",
        () =>
          incrementEsProcessOutboxTotal({
            processName: "p",
            intentType: "i",
            status: "dispatched",
          }),
      ],
      [
        "es_process_outbox_duration_milliseconds",
        () => observeEsProcessOutboxDuration({ processName: "p", intentType: "i", durationMs: 1 }),
      ],
      [
        "es_projection_subscriber_total",
        () => incrementEsProjectionSubscriberTotal("p", "s", "completed"),
      ],
      [
        "es_projection_subscriber_duration_milliseconds",
        () => observeEsProjectionSubscriberDuration("p", "s", 1),
      ],
      ["es_fold_cache_total", () => incrementEsFoldCacheTotal("x", "hit")],
      [
        "es_fold_cache_get_duration_milliseconds",
        () => observeEsFoldCacheGetDuration("x", "redis", 1),
      ],
      ["es_fold_cache_store_duration_milliseconds", () => observeEsFoldCacheStoreDuration("x", 1)],
      ["es_fold_cache_redis_error_total", () => incrementEsFoldCacheRedisError("x", "get")],
    ])("writes %s", (metricName, record) => {
      record();

      expect(meter.valuesOf(metricName)).toHaveLength(1);
    });

    /**
     * Pinned by name: a rename or accidental removal would break the redelivery
     * dashboard silently, and this counter is the only signal that separates a
     * fold failure that left durable state behind from one that did not.
     */
    it("writes es_fold_post_store_failure_total with its stage label", () => {
      incrementEsFoldPostStoreFailure({
        projectionName: "traceSummary",
        stage: "subscriber_dispatch",
      });

      expect(
        meter.valueOf("es_fold_post_store_failure_total", {
          projection_name: "traceSummary",
          stage: "subscriber_dispatch",
        }),
      ).toBe(1);
    });
  });

  describe("when deprecated metrics are removed", () => {
    it("writes nothing to the retired series", () => {
      incrementEsCommandTotal("p", "StartRun", "completed");

      for (const name of [
        "collector_index_delay_milliseconds",
        "event_sourcing_lock_contention_total",
        "event_sourcing_checkpoint_lag",
      ]) {
        expect(meter.descriptionOf(name)).toBeUndefined();
      }
    });
  });

  describe("when command metrics are recorded", () => {
    it("increments command total and records correct labels", () => {
      incrementEsCommandTotal("test-pipeline", "StartRun", "completed");
      incrementEsCommandTotal("test-pipeline", "StartRun", "failed");

      for (const status of ["completed", "failed"]) {
        expect(
          meter.valueOf("es_command_total", {
            pipeline_name: "test-pipeline",
            command_type: "StartRun",
            status,
          }),
        ).toBe(1);
      }
    });

    it("records command duration with correct labels", () => {
      observeEsCommandDuration("test-pipeline", "StartRun", 42.5);

      expect(
        meter.valuesOf("es_command_duration_milliseconds", {
          pipeline_name: "test-pipeline",
          command_type: "StartRun",
        }),
      ).toEqual([42.5]);
    });
  });

  describe("when fold projection metrics are recorded", () => {
    it("increments fold projection total with correct labels", () => {
      incrementEsFoldProjectionTotal({
        pipelineName: "test-pipeline",
        projectionName: "traceSummary",
        status: "completed",
      });

      expect(
        meter.valueOf("es_fold_projection_total", {
          pipeline_name: "test-pipeline",
          projection_name: "traceSummary",
          status: "completed",
        }),
      ).toBe(1);
    });

    it("records fold projection duration with correct labels", () => {
      observeEsFoldProjectionDuration({
        pipelineName: "test-pipeline",
        projectionName: "traceSummary",
        durationMs: 12.3,
      });

      expect(
        meter.valuesOf("es_fold_projection_duration_milliseconds", {
          pipeline_name: "test-pipeline",
          projection_name: "traceSummary",
        }),
      ).toEqual([12.3]);
    });
  });

  describe("when map projection metrics are recorded", () => {
    it("increments map projection total with correct labels", () => {
      incrementEsMapProjectionTotal({
        pipelineName: "test-pipeline",
        projectionName: "evaluationSync",
        status: "completed",
      });

      expect(
        meter.valueOf("es_map_projection_total", {
          pipeline_name: "test-pipeline",
          projection_name: "evaluationSync",
          status: "completed",
        }),
      ).toBe(1);
    });

    it("records map projection duration with correct labels", () => {
      observeEsMapProjectionDuration({
        pipelineName: "test-pipeline",
        projectionName: "evaluationSync",
        durationMs: 5.7,
      });

      expect(
        meter.valuesOf("es_map_projection_duration_milliseconds", {
          pipeline_name: "test-pipeline",
          projection_name: "evaluationSync",
        }),
      ).toEqual([5.7]);
    });
  });

  describe("when unified projection metrics are recorded", () => {
    it("records state projections with bounded kind labels", () => {
      incrementEsProjectionTotal({
        pipelineName: "langy",
        projectionKind: "state",
        projectionName: "conversation",
        status: "completed",
      });
      incrementEsProjectionTotal({
        pipelineName: "trace",
        projectionKind: "fold",
        projectionName: "summary",
        status: "completed",
      });
      incrementEsProjectionTotal({
        pipelineName: "trace",
        projectionKind: "map",
        projectionName: "storage",
        status: "failed",
      });
      observeEsProjectionDuration({
        pipelineName: "langy",
        projectionKind: "state",
        projectionName: "conversation",
        durationMs: 7.5,
      });

      for (const projectionKind of ["fold", "map", "state"]) {
        expect(meter.valueOf("es_projection_total", { projection_kind: projectionKind })).toBe(1);
      }
      expect(meter.valueOf("es_projection_total", { projection_name: "conversation" })).toBe(1);
      expect(
        meter.valuesOf("es_projection_duration_milliseconds", {
          pipeline_name: "langy",
          projection_kind: "state",
        }),
      ).toEqual([7.5]);
    });
  });

  describe("when subscriber and process-manager metrics are recorded", () => {
    it("records subscriber outcomes and duration", () => {
      incrementEsSubscriberTotal({
        pipelineName: "trace",
        subscriberName: "audit",
        status: "failed",
      });
      observeEsSubscriberDuration({
        pipelineName: "trace",
        subscriberName: "audit",
        durationMs: 3.2,
      });

      expect(
        meter.valueOf("es_subscriber_total", { subscriber_name: "audit", status: "failed" }),
      ).toBe(1);
      expect(
        meter.valuesOf("es_subscriber_duration_milliseconds", {
          pipeline_name: "trace",
          subscriber_name: "audit",
        }),
      ).toEqual([3.2]);
    });

    it("records every process-manager outcome and outbox disposition", () => {
      const outcomes = [
        "committed",
        "duplicate_event",
        "stale_wake",
        "revision_conflict",
        "failed",
      ] as const;
      for (const outcome of outcomes) {
        incrementEsProcessManagerTotal({
          processName: "langy-conversation",
          inputKind: outcome === "stale_wake" ? "wake" : "event",
          outcome,
        });
      }
      observeEsProcessManagerDuration({
        processName: "langy-conversation",
        inputKind: "wake",
        durationMs: 8,
      });
      const outboxStatuses = ["dispatched", "retried", "dead"] as const;
      for (const status of outboxStatuses) {
        incrementEsProcessOutboxTotal({
          processName: "langy-conversation",
          intentType: "worker-dispatch",
          status,
        });
      }
      observeEsProcessOutboxDuration({
        processName: "langy-conversation",
        intentType: "worker-dispatch",
        durationMs: 12,
      });

      expect(meter.valueOf("es_process_manager_total", { input_kind: "event" })).toBe(4);
      expect(meter.valueOf("es_process_manager_total", { input_kind: "wake" })).toBe(1);
      for (const outcome of outcomes) {
        expect(meter.valueOf("es_process_manager_total", { outcome })).toBe(1);
      }
      expect(
        meter.valuesOf("es_process_manager_duration_milliseconds", {
          process_name: "langy-conversation",
          input_kind: "wake",
        }),
      ).toEqual([8]);
      for (const status of outboxStatuses) {
        expect(
          meter.valueOf("es_process_outbox_total", {
            intent_type: "worker-dispatch",
            status,
          }),
        ).toBe(1);
      }
      expect(
        meter.valuesOf("es_process_outbox_duration_milliseconds", {
          process_name: "langy-conversation",
          intent_type: "worker-dispatch",
        }),
      ).toEqual([12]);
    });
  });

  describe("when subscriber metrics are recorded", () => {
    it("increments subscriber total with correct labels", () => {
      incrementEsProjectionSubscriberTotal("test-pipeline", "evaluationTrigger", "completed");

      expect(
        meter.valueOf("es_projection_subscriber_total", {
          pipeline_name: "test-pipeline",
          subscriber_name: "evaluationTrigger",
          status: "completed",
        }),
      ).toBe(1);
    });

    it("records subscriber duration with correct labels", () => {
      observeEsProjectionSubscriberDuration("test-pipeline", "evaluationTrigger", 150.0);

      expect(
        meter.valuesOf("es_projection_subscriber_duration_milliseconds", {
          pipeline_name: "test-pipeline",
          subscriber_name: "evaluationTrigger",
        }),
      ).toEqual([150]);
    });
  });

  describe("when fold cache metrics are recorded", () => {
    it("increments cache total for hit/miss/fallback_error with correct labels", () => {
      incrementEsFoldCacheTotal("traceSummary", "hit");
      incrementEsFoldCacheTotal("traceSummary", "miss");
      incrementEsFoldCacheTotal("traceSummary", "fallback_error");

      for (const result of ["hit", "miss", "fallback_error"]) {
        expect(
          meter.valueOf("es_fold_cache_total", { projection_name: "traceSummary", result }),
        ).toBe(1);
      }
    });

    it("records cache get duration with source labels", () => {
      observeEsFoldCacheGetDuration("traceSummary", "redis", 0.5);
      observeEsFoldCacheGetDuration("traceSummary", "clickhouse", 15.2);

      expect(
        meter.valuesOf("es_fold_cache_get_duration_milliseconds", {
          projection_name: "traceSummary",
          source: "redis",
        }),
      ).toEqual([0.5]);
      expect(
        meter.valuesOf("es_fold_cache_get_duration_milliseconds", {
          projection_name: "traceSummary",
          source: "clickhouse",
        }),
      ).toEqual([15.2]);
    });

    it("records cache store duration with correct labels", () => {
      observeEsFoldCacheStoreDuration("traceSummary", 8.1);

      expect(
        meter.valuesOf("es_fold_cache_store_duration_milliseconds", {
          projection_name: "traceSummary",
        }),
      ).toEqual([8.1]);
    });

    it("increments redis error total with operation labels", () => {
      incrementEsFoldCacheRedisError("traceSummary", "get");
      incrementEsFoldCacheRedisError("traceSummary", "set");

      for (const operation of ["get", "set"]) {
        expect(
          meter.valueOf("es_fold_cache_redis_error_total", {
            projection_name: "traceSummary",
            operation,
          }),
        ).toBe(1);
      }
    });
  });

  describe("withMetrics()", () => {
    it("calls onComplete with elapsed duration on success", async () => {
      let recordedMs = -1;
      const result = await withMetrics({
        fn: async () => "ok",
        onComplete: (ms) => {
          recordedMs = ms;
        },
        onFail: () => {
          throw new Error("should not be called");
        },
      });

      expect(result).toBe("ok");
      expect(recordedMs).toBeGreaterThanOrEqual(0);
    });

    it("calls onFail with elapsed duration and re-throws on error", async () => {
      let recordedMs = -1;
      const boom = new Error("boom");

      await expect(
        withMetrics({
          fn: async () => {
            throw boom;
          },
          onComplete: () => {
            throw new Error("should not be called");
          },
          onFail: (ms) => {
            recordedMs = ms;
          },
        }),
      ).rejects.toThrow("boom");

      expect(recordedMs).toBeGreaterThanOrEqual(0);
    });
  });
});
