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
  incrementEsReactorTotal,
  observeEsReactorDuration,
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
      const metric = register.getSingleMetric(
        "event_sourcing_checkpoint_lag",
      );
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
      incrementEsFoldProjectionTotal(
        "test-pipeline",
        "traceSummary",
        "completed",
      );

      const lines = await register.getSingleMetricAsString(
        "es_fold_projection_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('projection_name="traceSummary"');
      expect(lines).toContain('status="completed"');
    });

    it("records fold projection duration with correct labels", async () => {
      observeEsFoldProjectionDuration("test-pipeline", "traceSummary", 12.3);

      const lines = await register.getSingleMetricAsString(
        "es_fold_projection_duration_milliseconds",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('projection_name="traceSummary"');
    });
  });

  describe("when map projection metrics are recorded", () => {
    it("increments map projection total with correct labels", async () => {
      incrementEsMapProjectionTotal(
        "test-pipeline",
        "evaluationSync",
        "completed",
      );

      const lines = await register.getSingleMetricAsString(
        "es_map_projection_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('projection_name="evaluationSync"');
      expect(lines).toContain('status="completed"');
    });

    it("records map projection duration with correct labels", async () => {
      observeEsMapProjectionDuration("test-pipeline", "evaluationSync", 5.7);

      const lines = await register.getSingleMetricAsString(
        "es_map_projection_duration_milliseconds",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('projection_name="evaluationSync"');
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
