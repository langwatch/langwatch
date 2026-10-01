// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the run-status fold keeps for source health: the failure count, the last success and
 * the point a stopped run read through to. Spec: specs/governance/ingestion-source-health.feature
 */
import {
  INGESTION_PULL_AGGREGATE_TYPE,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
  deriveNoDataSinceNotice,
  deriveSourceHealth,
  ingestionPullRunCompletedEventSchema,
  ingestionPullRunFailedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { MemoryIngestionPullRunRepository } from "../../repositories/memory/memory.ingestion-pull-run.repository.ts";
import {
  type IngestionPullRunStatusData,
  IngestionPullRunStatusEventingProjection,
} from "../ingestion-pull-run-status-eventing.projection.ts";

const projection = IngestionPullRunStatusEventingProjection.create(
  MemoryIngestionPullRunRepository.create(),
);

function row(overrides: Partial<IngestionPullRunStatusData> = {}): IngestionPullRunStatusData {
  return {
    SourceId: "source-1",
    Enabled: true,
    Cron: "*/15 * * * *",
    Cursor: null,
    LastRunAt: null,
    LastRunOutcome: null,
    LastRunEventCount: 0,
    LastRunError: null,
    LastRunErrorCode: null,
    ConsecutiveErrors: 0,
    LastRunScheduledFor: null,
    LastSuccessAt: 500,
    LastReadThroughAt: null,
    LastRunCompleteness: null,
    LastAgentsListingAt: null,
    LastAgentsListingOutcome: null,
    LastAgentsListingCount: null,
    LastAgentsListingReason: null,
    LastAgentsListingStatus: null,
    LastPeopleListingAt: null,
    LastPeopleListingOutcome: null,
    LastPeopleDirectoryCount: null,
    LastPeopleWithheldCount: null,
    LastPeopleListingReason: null,
    LastPeopleListingStatus: null,
    CreatedAt: 1,
    UpdatedAt: 1,
    LastEventOccurredAt: 1,
    ...overrides,
  };
}

const envelope = {
  id: "event-1",
  aggregateId: "source-1",
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  tenantId: "project-1",
  createdAt: 9_000,
  occurredAt: 9_000,
};

function completed(data: Partial<Parameters<typeof completedData>[0]> = {}) {
  return ingestionPullRunCompletedEventSchema.parse({
    ...envelope,
    type: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
    version: INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED,
    data: completedData(data),
  });
}

function completedData(over: { scheduledFor?: number; errorCount?: number; eventCount?: number }) {
  return {
    sourceId: "source-1",
    runId: "run-1",
    scheduledFor: 8_000,
    nextCursor: null,
    eventCount: 3,
    ...over,
  };
}

function failed() {
  return ingestionPullRunFailedEventSchema.parse({
    ...envelope,
    type: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
    version: INGESTION_PULL_EVENT_VERSIONS.RUN_FAILED,
    data: {
      sourceId: "source-1",
      runId: "run-1",
      scheduledFor: 8_000,
      error: "boom",
      errorCode: "transport",
      retryable: true,
    },
  });
}

const health = (state: IngestionPullRunStatusData) =>
  deriveSourceHealth({ consecutiveFailures: state.ConsecutiveErrors });

describe("the run-status fold as source health reads it", () => {
  describe("given the source's last run succeeded", () => {
    /** @scenario A single failed run does not mark the source unhealthy */
    it("keeps the source healthy after one failed run", () => {
      const next = projection.handleIngestionPullRunFailed(failed(), row());

      expect(next.ConsecutiveErrors).toBe(1);
      expect(health(next)).toBe("healthy");
    });
  });

  describe("when three runs in a row fail", () => {
    /** @scenario Three consecutive failed runs mark the source unhealthy */
    it("marks the source unhealthy on the third", () => {
      const afterTwo = [1, 2].reduce(
        (state) => projection.handleIngestionPullRunFailed(failed(), state),
        row(),
      );
      expect(health(afterTwo)).toBe("healthy");

      const afterThree = projection.handleIngestionPullRunFailed(failed(), afterTwo);

      expect(health(afterThree)).toBe("unhealthy");
    });
  });

  describe("given the source has two consecutive failed runs", () => {
    /** @scenario A successful run records its time and resets the failure count */
    it("stamps the success and starts the count over", () => {
      const next = projection.handleIngestionPullRunCompleted(
        completed(),
        row({ ConsecutiveErrors: 2 }),
      );

      expect(next.LastSuccessAt).toBe(9_000);
      expect(next.ConsecutiveErrors).toBe(0);
    });

    /** @scenario A run that partly succeeded does not reset the failure count */
    it("neither resets nor raises the count, and leaves the last success alone", () => {
      const next = projection.handleIngestionPullRunCompleted(
        completed({ errorCount: 1 }),
        row({ ConsecutiveErrors: 2 }),
      );

      expect(next.ConsecutiveErrors).toBe(2);
      expect(next.LastSuccessAt).toBe(500);
    });
  });

  describe("given the provider reports no new usage for the period", () => {
    /** @scenario A run that finds nothing new still counts as a success */
    it("counts a run of no events, without error, as a success", () => {
      const next = projection.handleIngestionPullRunCompleted(
        completed({ eventCount: 0 }),
        row({ ConsecutiveErrors: 2 }),
      );

      expect(next).toMatchObject({ LastRunOutcome: "completed", ConsecutiveErrors: 0 });
      expect(next.LastSuccessAt).toBe(9_000);
    });
  });

  describe("given the provider holds more pages than one run is allowed to read", () => {
    const truncated = ingestionPullRunCompletedEventSchema.parse({
      ...envelope,
      type: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
      version: INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED,
      data: { ...completedData({}), completeness: "truncated", readThroughAt: 4_000 },
    });

    /** @scenario A run that stopped at its page limit records the point it read through to */
    it("records where the run read through to and that it stopped before the end", () => {
      const next = projection.handleIngestionPullRunCompleted(truncated, row());

      expect(next).toMatchObject({ LastReadThroughAt: 4_000, LastRunCompleteness: "truncated" });
    });

    /** @scenario A run that ran out of time before the end is remembered the same way */
    it("remembers a run cut off by its deadline in the same two columns", () => {
      const next = projection.handleIngestionPullRunCompleted(
        truncated,
        row({ LastRunCompleteness: "complete", LastReadThroughAt: 1_000 }),
      );

      expect(next).toMatchObject({ LastReadThroughAt: 4_000, LastRunCompleteness: "truncated" });
    });

    /** @scenario A source stuck half-read keeps reporting the same stopped-at point */
    it("keeps the stopped-at point the run before it reported", () => {
      const once = projection.handleIngestionPullRunCompleted(truncated, row());
      const again = projection.handleIngestionPullRunCompleted(
        completed({ scheduledFor: 8_500 }),
        once,
      );

      expect(again).toMatchObject({ LastReadThroughAt: 4_000, LastRunCompleteness: "truncated" });
    });
  });
});

describe("what a viewer is told of a source whose last run stopped before the end", () => {
  /** @scenario A source whose last run stopped early is shown as partly collected */
  it("names the point it read through to and states no date for a finished collection", () => {
    const notice = deriveNoDataSinceNotice({
      status: "active",
      errorCount: 0,
      lastSuccessAt: "2026-01-10T00:00:00.000Z",
      completeness: "truncated",
      readThroughAt: "2026-01-15T10:30:00.000Z",
    });

    expect(notice).toEqual({ readThroughIso: "2026-01-15T10:30:00.000Z", finished: false });
    expect(notice).not.toHaveProperty("lastSuccessIso");
  });
});
