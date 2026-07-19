import { describe, it, expect, beforeEach } from "vitest";
import { register } from "prom-client";

// Import all new metric functions to verify they exist and are callable
import {
  incrementEsCommandTotal,
  observeEsCommandDuration,
  incrementEsFoldProjectionTotal,
  observeEsFoldProjectionDuration,
  incrementEsMapProjectionTotal,
  observeEsMapProjectionDuration,
  incrementEsProjectionTotal,
  observeEsProjectionDuration,
  incrementEsReactorTotal,
  observeEsReactorDuration,
  incrementEsSubscriberTotal,
  observeEsSubscriberDuration,
  incrementEsProcessManagerTotal,
  observeEsProcessManagerDuration,
  incrementEsProcessOutboxTotal,
  observeEsProcessOutboxDuration,
  incrementEsFoldCacheTotal,
  observeEsFoldCacheGetDuration,
  observeEsFoldCacheStoreDuration,
  incrementEsFoldCacheRedisError,
  withMetrics,
} from "../metrics";

describe("ES pipeline metrics", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  describe("when metrics module is loaded", () => {
    it("registers es_command_total counter", () => {
      const metric = register.getSingleMetric("es_command_total");
      expect(metric).toBeDefined();
    });

    it("registers es_command_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric(
        "es_command_duration_milliseconds",
      );
      expect(metric).toBeDefined();
    });

    it("registers es_fold_projection_total counter", () => {
      const metric = register.getSingleMetric("es_fold_projection_total");
      expect(metric).toBeDefined();
    });

    it("registers es_fold_projection_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric(
        "es_fold_projection_duration_milliseconds",
      );
      expect(metric).toBeDefined();
    });

    it("registers es_map_projection_total counter", () => {
      const metric = register.getSingleMetric("es_map_projection_total");
      expect(metric).toBeDefined();
    });

    it("registers es_map_projection_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric(
        "es_map_projection_duration_milliseconds",
      );
      expect(metric).toBeDefined();
    });

    it.each([
      "es_projection_total",
      "es_projection_duration_milliseconds",
      "es_subscriber_total",
      "es_subscriber_duration_milliseconds",
      "es_process_manager_total",
      "es_process_manager_duration_milliseconds",
      "es_process_outbox_total",
      "es_process_outbox_duration_milliseconds",
    ])("registers %s", (metricName) => {
      expect(register.getSingleMetric(metricName)).toBeDefined();
    });

    it("registers es_reactor_total counter", () => {
      const metric = register.getSingleMetric("es_reactor_total");
      expect(metric).toBeDefined();
    });

    it("registers es_reactor_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric(
        "es_reactor_duration_milliseconds",
      );
      expect(metric).toBeDefined();
    });

    it("registers es_fold_cache_total counter", () => {
      const metric = register.getSingleMetric("es_fold_cache_total");
      expect(metric).toBeDefined();
    });

    it("registers es_fold_cache_get_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric(
        "es_fold_cache_get_duration_milliseconds",
      );
      expect(metric).toBeDefined();
    });

    it("registers es_fold_cache_store_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric(
        "es_fold_cache_store_duration_milliseconds",
      );
      expect(metric).toBeDefined();
    });

    it("registers es_fold_cache_redis_error_total counter", () => {
      const metric = register.getSingleMetric(
        "es_fold_cache_redis_error_total",
      );
      expect(metric).toBeDefined();
    });
  });

  describe("when deprecated metrics are removed", () => {
    it("does not register collector_index_delay_milliseconds", () => {
      const metric = register.getSingleMetric(
        "collector_index_delay_milliseconds",
      );
      expect(metric).toBeUndefined();
    });

    it("does not register event_sourcing_lock_contention_total", () => {
      const metric = register.getSingleMetric(
        "event_sourcing_lock_contention_total",
      );
      expect(metric).toBeUndefined();
    });

    it("does not register event_sourcing_checkpoint_lag", () => {
      const metric = register.getSingleMetric("event_sourcing_checkpoint_lag");
      expect(metric).toBeUndefined();
    });
  });

  describe("when command metrics are recorded", () => {
    it("increments command total and records correct labels", async () => {
      incrementEsCommandTotal("test-pipeline", "StartRun", "completed");
      incrementEsCommandTotal("test-pipeline", "StartRun", "failed");

      const lines = await register.getSingleMetricAsString("es_command_total");
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('command_type="StartRun"');
      expect(lines).toContain('status="completed"');
      expect(lines).toContain('status="failed"');
    });

    it("records command duration with correct labels", async () => {
      observeEsCommandDuration("test-pipeline", "StartRun", 42.5);

      const lines = await register.getSingleMetricAsString(
        "es_command_duration_milliseconds",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('command_type="StartRun"');
    });
  });

  describe("when fold projection metrics are recorded", () => {
    it("increments fold projection total with correct labels", async () => {
      incrementEsFoldProjectionTotal({
        pipelineName: "test-pipeline",
        projectionName: "traceSummary",
        status: "completed",
      });

      const lines = await register.getSingleMetricAsString(
        "es_fold_projection_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('projection_name="traceSummary"');
      expect(lines).toContain('status="completed"');
    });

    it("records fold projection duration with correct labels", async () => {
      observeEsFoldProjectionDuration({
        pipelineName: "test-pipeline",
        projectionName: "traceSummary",
        durationMs: 12.3,
      });

      const lines = await register.getSingleMetricAsString(
        "es_fold_projection_duration_milliseconds",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('projection_name="traceSummary"');
    });
  });

  describe("when map projection metrics are recorded", () => {
    it("increments map projection total with correct labels", async () => {
      incrementEsMapProjectionTotal({
        pipelineName: "test-pipeline",
        projectionName: "evaluationSync",
        status: "completed",
      });

      const lines = await register.getSingleMetricAsString(
        "es_map_projection_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('projection_name="evaluationSync"');
      expect(lines).toContain('status="completed"');
    });

    it("records map projection duration with correct labels", async () => {
      observeEsMapProjectionDuration({
        pipelineName: "test-pipeline",
        projectionName: "evaluationSync",
        durationMs: 5.7,
      });

      const lines = await register.getSingleMetricAsString(
        "es_map_projection_duration_milliseconds",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('projection_name="evaluationSync"');
    });
  });

  describe("when unified projection metrics are recorded", () => {
    it("records fold, map, and state projections with bounded kind labels", async () => {
      incrementEsFoldProjectionTotal({
        pipelineName: "trace",
        projectionName: "summary",
        status: "completed",
      });
      incrementEsMapProjectionTotal({
        pipelineName: "trace",
        projectionName: "storage",
        status: "failed",
      });
      incrementEsProjectionTotal({
        pipelineName: "langy",
        projectionKind: "state",
        projectionName: "conversation",
        status: "completed",
      });
      observeEsProjectionDuration({
        pipelineName: "langy",
        projectionKind: "state",
        projectionName: "conversation",
        durationMs: 7.5,
      });

      const totals = await register.getSingleMetricAsString(
        "es_projection_total",
      );
      expect(totals).toContain('projection_kind="fold"');
      expect(totals).toContain('projection_kind="map"');
      expect(totals).toContain('projection_kind="state"');
      expect(totals).toContain('projection_name="conversation"');

      const durations = await register.getSingleMetricAsString(
        "es_projection_duration_milliseconds",
      );
      expect(durations).toContain('pipeline_name="langy"');
      expect(durations).toContain('projection_kind="state"');
    });
  });

  describe("when subscriber and process-manager metrics are recorded", () => {
    it("records subscriber outcomes and duration", async () => {
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

      const totals = await register.getSingleMetricAsString(
        "es_subscriber_total",
      );
      expect(totals).toContain('subscriber_name="audit"');
      expect(totals).toContain('status="failed"');

      const durations = await register.getSingleMetricAsString(
        "es_subscriber_duration_milliseconds",
      );
      expect(durations).toContain('pipeline_name="trace"');
      expect(durations).toContain('subscriber_name="audit"');
    });

    it("records every process-manager outcome and outbox disposition", async () => {
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

      const processTotals = await register.getSingleMetricAsString(
        "es_process_manager_total",
      );
      expect(processTotals).toContain('input_kind="event"');
      for (const outcome of outcomes) {
        expect(processTotals).toContain(`outcome="${outcome}"`);
      }

      const processDurations = await register.getSingleMetricAsString(
        "es_process_manager_duration_milliseconds",
      );
      expect(processDurations).toContain('process_name="langy-conversation"');
      expect(processDurations).toContain('input_kind="wake"');

      const outboxTotals = await register.getSingleMetricAsString(
        "es_process_outbox_total",
      );
      expect(outboxTotals).toContain('intent_type="worker-dispatch"');
      for (const status of outboxStatuses) {
        expect(outboxTotals).toContain(`status="${status}"`);
      }

      const outboxDurations = await register.getSingleMetricAsString(
        "es_process_outbox_duration_milliseconds",
      );
      expect(outboxDurations).toContain('process_name="langy-conversation"');
      expect(outboxDurations).toContain('intent_type="worker-dispatch"');
    });
  });

  describe("when reactor metrics are recorded", () => {
    it("increments reactor total with correct labels", async () => {
      incrementEsReactorTotal(
        "test-pipeline",
        "evaluationTrigger",
        "completed",
      );

      const lines = await register.getSingleMetricAsString("es_reactor_total");
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('reactor_name="evaluationTrigger"');
      expect(lines).toContain('status="completed"');
    });

    it("records reactor duration with correct labels", async () => {
      observeEsReactorDuration("test-pipeline", "evaluationTrigger", 150.0);

      const lines = await register.getSingleMetricAsString(
        "es_reactor_duration_milliseconds",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('reactor_name="evaluationTrigger"');
    });
  });

  describe("when fold cache metrics are recorded", () => {
    it("increments cache total for hit/miss/fallback_error with correct labels", async () => {
      incrementEsFoldCacheTotal("traceSummary", "hit");
      incrementEsFoldCacheTotal("traceSummary", "miss");
      incrementEsFoldCacheTotal("traceSummary", "fallback_error");

      const lines = await register.getSingleMetricAsString(
        "es_fold_cache_total",
      );
      expect(lines).toContain('projection_name="traceSummary"');
      expect(lines).toContain('result="hit"');
      expect(lines).toContain('result="miss"');
      expect(lines).toContain('result="fallback_error"');
    });

    it("records cache get duration with source labels", async () => {
      observeEsFoldCacheGetDuration("traceSummary", "redis", 0.5);
      observeEsFoldCacheGetDuration("traceSummary", "clickhouse", 15.2);

      const lines = await register.getSingleMetricAsString(
        "es_fold_cache_get_duration_milliseconds",
      );
      expect(lines).toContain('projection_name="traceSummary"');
      expect(lines).toContain('source="redis"');
      expect(lines).toContain('source="clickhouse"');
    });

    it("records cache store duration with correct labels", async () => {
      observeEsFoldCacheStoreDuration("traceSummary", 8.1);

      const lines = await register.getSingleMetricAsString(
        "es_fold_cache_store_duration_milliseconds",
      );
      expect(lines).toContain('projection_name="traceSummary"');
    });

    it("increments redis error total with operation labels", async () => {
      incrementEsFoldCacheRedisError("traceSummary", "get");
      incrementEsFoldCacheRedisError("traceSummary", "set");

      const lines = await register.getSingleMetricAsString(
        "es_fold_cache_redis_error_total",
      );
      expect(lines).toContain('projection_name="traceSummary"');
      expect(lines).toContain('operation="get"');
      expect(lines).toContain('operation="set"');
    });
  });

  describe("withMetrics", () => {
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
