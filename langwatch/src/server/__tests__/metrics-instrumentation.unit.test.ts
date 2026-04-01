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
  eventSourcingStoreDurationHistogram,
} from "../metrics";

describe("ES pipeline metrics", () => {
  describe("when metrics module is loaded", () => {
    it("registers es_command_total counter", () => {
      const metric = register.getSingleMetric("es_command_total");
      expect(metric).toBeDefined();
    });

    it("registers es_command_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric("es_command_duration_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers es_fold_projection_total counter", () => {
      const metric = register.getSingleMetric("es_fold_projection_total");
      expect(metric).toBeDefined();
    });

    it("registers es_fold_projection_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric("es_fold_projection_duration_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers es_map_projection_total counter", () => {
      const metric = register.getSingleMetric("es_map_projection_total");
      expect(metric).toBeDefined();
    });

    it("registers es_map_projection_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric("es_map_projection_duration_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers es_reactor_total counter", () => {
      const metric = register.getSingleMetric("es_reactor_total");
      expect(metric).toBeDefined();
    });

    it("registers es_reactor_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric("es_reactor_duration_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers es_fold_cache_total counter", () => {
      const metric = register.getSingleMetric("es_fold_cache_total");
      expect(metric).toBeDefined();
    });

    it("registers es_fold_cache_get_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric("es_fold_cache_get_duration_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers es_fold_cache_store_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric("es_fold_cache_store_duration_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers es_fold_cache_redis_error_total counter", () => {
      const metric = register.getSingleMetric("es_fold_cache_redis_error_total");
      expect(metric).toBeDefined();
    });
  });

  describe("when deprecated metrics are removed", () => {
    it("does not register collector_index_delay_milliseconds", () => {
      const metric = register.getSingleMetric("collector_index_delay_milliseconds");
      expect(metric).toBeUndefined();
    });

    it("does not register event_sourcing_lock_contention_total", () => {
      const metric = register.getSingleMetric("event_sourcing_lock_contention_total");
      expect(metric).toBeUndefined();
    });

    it("does not register event_sourcing_checkpoint_lag", () => {
      const metric = register.getSingleMetric("event_sourcing_checkpoint_lag");
      expect(metric).toBeUndefined();
    });
  });

  describe("when command metrics are recorded", () => {
    it("increments command total without throwing", () => {
      expect(() => incrementEsCommandTotal("test-pipeline", "StartRun", "completed")).not.toThrow();
      expect(() => incrementEsCommandTotal("test-pipeline", "StartRun", "failed")).not.toThrow();
    });

    it("observes command duration without throwing", () => {
      expect(() => observeEsCommandDuration("test-pipeline", "StartRun", 42.5)).not.toThrow();
    });
  });

  describe("when fold projection metrics are recorded", () => {
    it("increments fold projection total without throwing", () => {
      expect(() => incrementEsFoldProjectionTotal("test-pipeline", "traceSummary", "completed")).not.toThrow();
    });

    it("observes fold projection duration without throwing", () => {
      expect(() => observeEsFoldProjectionDuration("test-pipeline", "traceSummary", 12.3)).not.toThrow();
    });
  });

  describe("when map projection metrics are recorded", () => {
    it("increments map projection total without throwing", () => {
      expect(() => incrementEsMapProjectionTotal("test-pipeline", "evaluationSync", "completed")).not.toThrow();
    });

    it("observes map projection duration without throwing", () => {
      expect(() => observeEsMapProjectionDuration("test-pipeline", "evaluationSync", 5.7)).not.toThrow();
    });
  });

  describe("when reactor metrics are recorded", () => {
    it("increments reactor total without throwing", () => {
      expect(() => incrementEsReactorTotal("test-pipeline", "evaluationTrigger", "completed")).not.toThrow();
    });

    it("observes reactor duration without throwing", () => {
      expect(() => observeEsReactorDuration("test-pipeline", "evaluationTrigger", 150.0)).not.toThrow();
    });
  });

  describe("when fold cache metrics are recorded", () => {
    it("increments cache total for hit/miss/fallback_error", () => {
      expect(() => incrementEsFoldCacheTotal("traceSummary", "hit")).not.toThrow();
      expect(() => incrementEsFoldCacheTotal("traceSummary", "miss")).not.toThrow();
      expect(() => incrementEsFoldCacheTotal("traceSummary", "fallback_error")).not.toThrow();
    });

    it("observes cache get duration for redis/clickhouse sources", () => {
      expect(() => observeEsFoldCacheGetDuration("traceSummary", "redis", 0.5)).not.toThrow();
      expect(() => observeEsFoldCacheGetDuration("traceSummary", "clickhouse", 15.2)).not.toThrow();
    });

    it("observes cache store duration without throwing", () => {
      expect(() => observeEsFoldCacheStoreDuration("traceSummary", 8.1)).not.toThrow();
    });

    it("increments redis error total for get/set operations", () => {
      expect(() => incrementEsFoldCacheRedisError("traceSummary", "get")).not.toThrow();
      expect(() => incrementEsFoldCacheRedisError("traceSummary", "set")).not.toThrow();
    });
  });
});
