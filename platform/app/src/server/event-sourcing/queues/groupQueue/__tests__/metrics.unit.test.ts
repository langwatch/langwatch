import { register } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  gqJobsUnroutableTotal,
  gqOldestPendingAgeMilliseconds,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
  recordDroppedJob,
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

    it("registers gq_oldest_backlog_age_milliseconds gauge", () => {
      const metric = register.getSingleMetric(
        "gq_oldest_backlog_age_milliseconds",
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

describe("first discarded job visibility", () => {
  beforeEach(() => {
    register.resetMetrics();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a worker with no previous discard series", () => {
    describe("when a job is discarded before and after a counter reset", () => {
      /** @scenario "The first discarded queue job is visible without a counter baseline" */
      it("exposes the first discard on the first scrape and again after a counter reset", async () => {
        const labels = {
          ...routingLabels,
          job_type: "subscriber",
          reason: "missing_blob",
        };
        recordDroppedJob(labels);
        const first = await register.getSingleMetricAsString(
          "gq_jobs_last_dropped_timestamp_seconds",
        );
        expect(first).toContain('pipeline_name="test-pipeline"');
        expect(first).toContain('job_type="subscriber"');
        expect(first).toContain('reason="missing_blob"');
        expect(first).toContain("1788775200");
        const counter = await register.getSingleMetricAsString(
          "gq_jobs_dropped_total",
        );
        expect(counter).toMatch(/reason="missing_blob"} 1/);

        register.resetMetrics();
        vi.advanceTimersByTime(20_000);
        recordDroppedJob(labels);
        const restarted = await register.getSingleMetricAsString(
          "gq_jobs_last_dropped_timestamp_seconds",
        );
        expect(restarted).toContain("1788775220");
      });
    });
  });

  describe("given unroutable work that will be reoffered", () => {
    describe("when its routing failure is recorded", () => {
      /** @scenario "The first discarded queue job is visible without a counter baseline" */
      it("does not record reoffered unroutable work as a discard", async () => {
        gqJobsUnroutableTotal.inc(routingLabels);
        const dropped = await register.getSingleMetricAsString(
          "gq_jobs_last_dropped_timestamp_seconds",
        );
        expect(dropped).not.toContain('queue_name="test-queue"');
        const unroutable = await register.getSingleMetricAsString(
          "gq_jobs_unroutable_total",
        );
        expect(unroutable).toMatch(/job_name="traceSummary"} 1/);
      });
    });
  });
});
