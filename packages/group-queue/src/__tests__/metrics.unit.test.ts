import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  gqOldestBacklogAgeMilliseconds,
  gqOldestPendingAgeMilliseconds,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
  recordDroppedJob,
} from "../metrics.ts";

const routingLabels = {
  queue_name: "test-queue",
  pipeline_name: "test-pipeline",
  job_type: "fold",
  job_name: "traceSummary",
};

let meter = createRecordingMeterProvider();

describe("GroupQueue metrics", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
  });
  afterEach(() => meter.uninstall());

  describe("when delayed job metrics are recorded", () => {
    it("records delayed total with routing labels", () => {
      gqJobsDelayedTotal.inc(routingLabels);

      expect(meter.valueOf("gq_jobs_delayed_total", routingLabels)).toBe(1);
    });

    it("records delay duration with routing labels", () => {
      gqJobDelayMilliseconds.observe(5000, routingLabels);

      expect(meter.valuesOf("gq_job_delay_milliseconds", routingLabels)).toEqual([5000]);
    });
  });

  describe("when retry metrics are recorded", () => {
    it("records retry attempt with routing labels", () => {
      gqRetryAttempt.observe(3, routingLabels);

      expect(meter.valuesOf("gq_retry_attempt", routingLabels)).toEqual([3]);
    });

    it("records retry backoff with routing labels", () => {
      gqRetryBackoffMilliseconds.observe(2000, routingLabels);

      expect(meter.valuesOf("gq_retry_backoff_milliseconds", routingLabels)).toEqual([2000]);
    });
  });

  describe("when job duration metrics are recorded", () => {
    it("records duration with all routing labels", () => {
      gqJobDurationMilliseconds.observe(150.5, routingLabels);

      expect(meter.valuesOf("gq_job_duration_milliseconds", routingLabels)).toEqual([150.5]);
    });
  });

  describe("when processing counters are recorded with routing labels", () => {
    /** @scenario "Group Queue series are recorded through the metrics facade" */
    it.each([
      ["completed total", "gq_jobs_completed_total", gqJobsCompletedTotal],
      ["retried total", "gq_jobs_retried_total", gqJobsRetriedTotal],
      ["exhausted total", "gq_jobs_exhausted_total", gqJobsExhaustedTotal],
      ["non-retryable total", "gq_jobs_non_retryable_total", gqJobsNonRetryableTotal],
      ["groups blocked total", "gq_groups_blocked_total", gqGroupsBlockedTotal],
    ])("records %s with routing labels", (_label, name, handle) => {
      handle.inc(routingLabels);

      expect(meter.valueOf(name, routingLabels)).toBe(1);
    });
  });

  describe("when oldest pending age is set", () => {
    it("records the gauge value for the queue", () => {
      gqOldestPendingAgeMilliseconds.set(1500, { queue_name: "test-queue" });

      expect(
        meter.valuesOf("gq_oldest_pending_age_milliseconds", { queue_name: "test-queue" }),
      ).toEqual([1500]);
    });

    it("records zero when no pending jobs", () => {
      gqOldestPendingAgeMilliseconds.set(0, { queue_name: "test-queue" });

      expect(
        meter.valuesOf("gq_oldest_pending_age_milliseconds", { queue_name: "test-queue" }),
      ).toEqual([0]);
    });

    it("records the oldest backlog age for the queue", () => {
      gqOldestBacklogAgeMilliseconds.set(900, { queue_name: "test-queue" });

      expect(
        meter.valuesOf("gq_oldest_backlog_age_milliseconds", { queue_name: "test-queue" }),
      ).toEqual([900]);
    });
  });

  describe("when blocked groups gauge is set", () => {
    it("exposes the value with the queue_name label", () => {
      gqBlockedGroups.set(3, { queue_name: "test-queue" });

      expect(meter.valuesOf("gq_blocked_groups", { queue_name: "test-queue" })).toEqual([3]);
    });

    it("can be reset to zero when no groups are blocked", () => {
      gqBlockedGroups.set(3, { queue_name: "test-queue" });
      gqBlockedGroups.set(0, { queue_name: "test-queue" });

      expect(meter.valuesOf("gq_blocked_groups", { queue_name: "test-queue" })).toEqual([3, 0]);
    });
  });
});

describe("first discarded job visibility", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    meter.uninstall();
  });

  describe("given a worker with no previous discard series", () => {
    describe("when a job is discarded twice, twenty seconds apart", () => {
      /** @scenario "The first discarded queue job is visible without a counter baseline" */
      it("writes the first discard's timestamp and counter, then a later timestamp", () => {
        const labels = {
          ...routingLabels,
          job_type: "subscriber",
          reason: "missing_blob",
        };
        recordDroppedJob(labels);

        expect(meter.valuesOf("gq_jobs_last_dropped_timestamp_seconds", labels)).toEqual([
          1788775200,
        ]);
        expect(meter.valueOf("gq_jobs_dropped_total", labels)).toBe(1);

        vi.advanceTimersByTime(20_000);
        recordDroppedJob(labels);

        expect(meter.valuesOf("gq_jobs_last_dropped_timestamp_seconds", labels)).toEqual([
          1788775200, 1788775220,
        ]);
        expect(meter.valueOf("gq_jobs_dropped_total", labels)).toBe(2);
      });
    });
  });

  describe("given unroutable work that will be reoffered", () => {
    describe("when its routing failure is recorded", () => {
      /** @scenario "The first discarded queue job is visible without a counter baseline" */
      it("does not record reoffered unroutable work as a discard", () => {
        gqJobsUnroutableTotal.inc(routingLabels);

        expect(meter.valuesOf("gq_jobs_last_dropped_timestamp_seconds")).toEqual([]);
        expect(meter.valueOf("gq_jobs_dropped_total")).toBe(0);
        expect(meter.valueOf("gq_jobs_unroutable_total", { job_name: "traceSummary" })).toBe(1);
      });
    });
  });
});
