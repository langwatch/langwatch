import { Counter, Gauge, Histogram, register } from "prom-client";
import { beforeEach, describe, expect, it } from "vitest";
// Namespace import so the registry-consistency check below can enumerate
// every export the module actually defines, independent of the named
// imports above (which only pull in what THIS file happens to exercise).
import * as metricsModule from "../metrics";
// Import to trigger metric registration
import {
  gqBlockedGroups,
  gqGroupsBlockedTotal,
  gqJobDelayMilliseconds,
  gqJobDurationMilliseconds,
  gqJobsCompletedTotal,
  gqJobsDelayedTotal,
  gqJobsExhaustedTotal,
  gqJobsNonRetryableTotal,
  gqJobsRetriedTotal,
  gqOldestPendingAgeMilliseconds,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
} from "../metrics";

const routingLabels = {
  queue_name: "test-queue",
  pipeline_name: "test-pipeline",
  job_type: "fold",
  job_name: "traceSummary",
};

describe("GroupQueue metrics", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  describe("when metrics module is loaded", () => {
    it("registers gq_jobs_delayed_total counter", () => {
      const metric = register.getSingleMetric("gq_jobs_delayed_total");
      expect(metric).toBeDefined();
    });

    it("registers gq_job_delay_milliseconds histogram", () => {
      const metric = register.getSingleMetric("gq_job_delay_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers gq_retry_attempt histogram", () => {
      const metric = register.getSingleMetric("gq_retry_attempt");
      expect(metric).toBeDefined();
    });

    it("registers gq_retry_backoff_milliseconds histogram", () => {
      const metric = register.getSingleMetric("gq_retry_backoff_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers gq_job_duration_milliseconds histogram", () => {
      const metric = register.getSingleMetric("gq_job_duration_milliseconds");
      expect(metric).toBeDefined();
    });

    it("registers gq_oldest_pending_age_milliseconds gauge", () => {
      const metric = register.getSingleMetric(
        "gq_oldest_pending_age_milliseconds",
      );
      expect(metric).toBeDefined();
    });

    it("registers gq_blocked_groups gauge", () => {
      const metric = register.getSingleMetric("gq_blocked_groups");
      expect(metric).toBeDefined();
    });
  });

  describe("when delayed job metrics are recorded", () => {
    it("records delayed total with routing labels", async () => {
      gqJobsDelayedTotal.inc(routingLabels);

      const lines = await register.getSingleMetricAsString(
        "gq_jobs_delayed_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_type="fold"');
      expect(lines).toContain('job_name="traceSummary"');
    });

    it("records delay duration with routing labels", async () => {
      gqJobDelayMilliseconds.observe(routingLabels, 5000);

      const lines = await register.getSingleMetricAsString(
        "gq_job_delay_milliseconds",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_type="fold"');
      expect(lines).toContain('job_name="traceSummary"');
    });
  });

  describe("when retry metrics are recorded", () => {
    it("records retry attempt with routing labels", async () => {
      gqRetryAttempt.observe(routingLabels, 3);

      const lines = await register.getSingleMetricAsString("gq_retry_attempt");
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_name="traceSummary"');
    });

    it("records retry backoff with routing labels", async () => {
      gqRetryBackoffMilliseconds.observe(routingLabels, 2000);

      const lines = await register.getSingleMetricAsString(
        "gq_retry_backoff_milliseconds",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_name="traceSummary"');
    });
  });

  describe("when job duration metrics are recorded", () => {
    it("records duration with all routing labels", async () => {
      gqJobDurationMilliseconds.observe(routingLabels, 150.5);

      const lines = await register.getSingleMetricAsString(
        "gq_job_duration_milliseconds",
      );
      expect(lines).toContain('queue_name="test-queue"');
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_type="fold"');
      expect(lines).toContain('job_name="traceSummary"');
    });
  });

  describe("when processing counters are recorded with routing labels", () => {
    it("records completed total with routing labels", async () => {
      gqJobsCompletedTotal.inc(routingLabels);

      const lines = await register.getSingleMetricAsString(
        "gq_jobs_completed_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_type="fold"');
      expect(lines).toContain('job_name="traceSummary"');
    });

    it("records retried total with routing labels", async () => {
      gqJobsRetriedTotal.inc(routingLabels);

      const lines = await register.getSingleMetricAsString(
        "gq_jobs_retried_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_name="traceSummary"');
    });

    it("records exhausted total with routing labels", async () => {
      gqJobsExhaustedTotal.inc(routingLabels);

      const lines = await register.getSingleMetricAsString(
        "gq_jobs_exhausted_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_name="traceSummary"');
    });

    it("records non-retryable total with routing labels", async () => {
      gqJobsNonRetryableTotal.inc(routingLabels);

      const lines = await register.getSingleMetricAsString(
        "gq_jobs_non_retryable_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_name="traceSummary"');
    });

    it("records groups blocked total with routing labels", async () => {
      gqGroupsBlockedTotal.inc(routingLabels);

      const lines = await register.getSingleMetricAsString(
        "gq_groups_blocked_total",
      );
      expect(lines).toContain('pipeline_name="test-pipeline"');
      expect(lines).toContain('job_name="traceSummary"');
    });
  });

  describe("when oldest pending age is set", () => {
    it("sets gauge value without throwing", () => {
      expect(() =>
        gqOldestPendingAgeMilliseconds.set({ queue_name: "test-queue" }, 1500),
      ).not.toThrow();
    });

    it("sets gauge to zero when no pending jobs", () => {
      expect(() =>
        gqOldestPendingAgeMilliseconds.set({ queue_name: "test-queue" }, 0),
      ).not.toThrow();
    });
  });

  describe("when blocked groups gauge is set", () => {
    it("exposes the value with the queue_name label", async () => {
      gqBlockedGroups.set({ queue_name: "test-queue" }, 3);

      const lines = await register.getSingleMetricAsString("gq_blocked_groups");
      expect(lines).toContain('queue_name="test-queue"');
      expect(lines).toContain("3");
    });

    it("can be reset to zero when no groups are blocked", () => {
      expect(() =>
        gqBlockedGroups.set({ queue_name: "test-queue" }, 0),
      ).not.toThrow();
    });
  });
});

type PromMetric = Counter<string> | Gauge<string> | Histogram<string>;

/**
 * prom-client assigns `name` onto the instance at construction time
 * (`Object.assign(this, ..., config)` in prom-client's shared `Metric` base —
 * lib/metric.js), but the public `Counter`/`Gauge`/`Histogram` types only
 * declare `name` on the constructor's configuration object, not on the
 * instance. Read it back with a narrow cast instead of the config object we
 * no longer have.
 */
function nameOf(metric: PromMetric): string {
  return (metric as unknown as { name: string }).name;
}

/**
 * Every metric this module actually defines, derived from its own exports —
 * NOT from `metricNames` — so this has independent power to disagree with
 * the hot-reload list below.
 */
function definedMetricNames(): Set<string> {
  return new Set(
    Object.values(metricsModule)
      .filter(
        (value): value is PromMetric =>
          value instanceof Counter ||
          value instanceof Gauge ||
          value instanceof Histogram,
      )
      .map(nameOf),
  );
}

describe("metricNames hot-reload list", () => {
  describe("when compared against the metrics the module actually exports", () => {
    it("lists every metric the module defines", () => {
      const defined = definedMetricNames();
      const listedNames: readonly string[] = metricsModule.metricNames;
      const missingFromList = [...defined].filter(
        (name) => !listedNames.includes(name),
      );

      expect(missingFromList).toEqual([]);
    });

    it("defines a real metric for every name it lists", () => {
      const defined = definedMetricNames();
      const staleListEntries = metricsModule.metricNames.filter(
        (name) => !defined.has(name),
      );

      expect(staleListEntries).toEqual([]);
    });
  });
});
