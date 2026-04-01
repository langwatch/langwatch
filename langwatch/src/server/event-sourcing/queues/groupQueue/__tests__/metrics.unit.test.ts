import { describe, it, expect } from "vitest";
import { register } from "prom-client";

// Import to trigger metric registration
import {
  gqJobsDelayedTotal,
  gqJobDelayMilliseconds,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
  gqJobDurationMilliseconds,
  gqOldestPendingAgeMilliseconds,
} from "../metrics";

describe("GroupQueue metrics", () => {
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
      const metric = register.getSingleMetric("gq_oldest_pending_age_milliseconds");
      expect(metric).toBeDefined();
    });
  });

  describe("when delayed job metrics are recorded", () => {
    it("increments delayed total without throwing", () => {
      expect(() => gqJobsDelayedTotal.inc({ queue_name: "test-queue" })).not.toThrow();
    });

    it("observes delay duration without throwing", () => {
      expect(() => gqJobDelayMilliseconds.observe({ queue_name: "test-queue" }, 5000)).not.toThrow();
    });
  });

  describe("when retry metrics are recorded", () => {
    it("observes retry attempt without throwing", () => {
      expect(() => gqRetryAttempt.observe({ queue_name: "test-queue" }, 3)).not.toThrow();
    });

    it("observes retry backoff without throwing", () => {
      expect(() => gqRetryBackoffMilliseconds.observe({ queue_name: "test-queue" }, 2000)).not.toThrow();
    });
  });

  describe("when job duration metrics are recorded", () => {
    it("observes duration with pipeline and job type labels", () => {
      expect(() =>
        gqJobDurationMilliseconds.observe(
          { queue_name: "test-queue", pipeline_name: "test-pipeline", job_type: "fold" },
          150.5,
        ),
      ).not.toThrow();
    });
  });

  describe("when oldest pending age is set", () => {
    it("sets gauge value without throwing", () => {
      expect(() => gqOldestPendingAgeMilliseconds.set({ queue_name: "test-queue" }, 1500)).not.toThrow();
    });

    it("sets gauge to zero when no pending jobs", () => {
      expect(() => gqOldestPendingAgeMilliseconds.set({ queue_name: "test-queue" }, 0)).not.toThrow();
    });
  });
});
