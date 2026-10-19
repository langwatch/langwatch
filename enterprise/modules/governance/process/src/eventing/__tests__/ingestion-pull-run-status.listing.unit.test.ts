import {
  INGESTION_PULL_AGGREGATE_TYPE,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
  ingestionPullAgentsListedEventSchema,
  ingestionPullAgentsListingRefusedEventSchema,
  ingestionPullPeopleListedEventSchema,
  ingestionPullRunCompletedEventSchema,
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

const envelope = {
  id: "event-1",
  aggregateId: "source-1",
  aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
  tenantId: "project-1",
  createdAt: 1_000,
  occurredAt: 1_000,
};

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
    ConsecutiveErrors: 2,
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

const agentsListed = (requestedAt: number) =>
  ingestionPullAgentsListedEventSchema.parse({
    ...envelope,
    type: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
    version: INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTED,
    data: { sourceId: "source-1", requestId: "req-1", requestedAt, agentCount: 4 },
  });

describe("the run-status fold's listing columns", () => {
  it("records a listed outcome with its count", () => {
    const next = projection.handleIngestionPullAgentsListed(agentsListed(2_000), row());

    expect(next).toMatchObject({
      LastAgentsListingAt: 2_000,
      LastAgentsListingOutcome: "listed",
      LastAgentsListingCount: 4,
      LastAgentsListingReason: null,
    });
  });

  it("records a refusal with no count", () => {
    const refused = ingestionPullAgentsListingRefusedEventSchema.parse({
      ...envelope,
      type: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
      version: INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REFUSED,
      data: {
        sourceId: "source-1",
        requestId: "req-2",
        requestedAt: 3_000,
        reason: "forbidden",
        status: 403,
      },
    });

    const next = projection.handleIngestionPullAgentsListingRefused(
      refused,
      row({ LastAgentsListingAt: 2_000, LastAgentsListingCount: 4 }),
    );

    expect(next).toMatchObject({
      LastAgentsListingOutcome: "refused",
      LastAgentsListingCount: null,
      LastAgentsListingReason: "forbidden",
      LastAgentsListingStatus: 403,
    });
  });

  it("ignores a listing asked before the one already recorded", () => {
    const state = row({ LastAgentsListingAt: 5_000, LastAgentsListingCount: 9 });

    expect(projection.handleIngestionPullAgentsListed(agentsListed(2_000), state)).toBe(state);
  });

  it("keeps both people counts", () => {
    const listed = ingestionPullPeopleListedEventSchema.parse({
      ...envelope,
      type: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED,
      version: INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTED,
      data: {
        sourceId: "source-1",
        requestId: "req-1",
        requestedAt: 2_000,
        directoryPersonCount: 10,
        withheldPersonCount: 3,
      },
    });

    expect(projection.handleIngestionPullPeopleListed(listed, row())).toMatchObject({
      LastPeopleListingOutcome: "listed",
      LastPeopleDirectoryCount: 10,
      LastPeopleWithheldCount: 3,
    });
  });
});

describe("the run-status fold's completion health", () => {
  const completed = (data: Record<string, unknown>) =>
    ingestionPullRunCompletedEventSchema.parse({
      ...envelope,
      occurredAt: 4_000,
      type: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
      version: INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED,
      data: {
        sourceId: "source-1",
        runId: "run-1",
        scheduledFor: 4_000,
        nextCursor: "c",
        eventCount: 2,
        ...data,
      },
    });

  it("resets failures and stamps success on a clean run", () => {
    expect(projection.handleIngestionPullRunCompleted(completed({}), row())).toMatchObject({
      ConsecutiveErrors: 0,
      LastSuccessAt: 4_000,
    });
  });

  it("holds failures and the last success on a run that skipped rows", () => {
    expect(
      projection.handleIngestionPullRunCompleted(completed({ errorCount: 1 }), row()),
    ).toMatchObject({ ConsecutiveErrors: 2, LastSuccessAt: 500 });
  });

  it("counts a page it could not read as a failure", () => {
    expect(
      projection.handleIngestionPullRunCompleted(
        completed({
          errorCount: 1,
          unreadPage: true,
          completeness: "truncated",
          readThroughAt: 3_000,
        }),
        row(),
      ),
    ).toMatchObject({
      ConsecutiveErrors: 3,
      LastRunCompleteness: "truncated",
      LastReadThroughAt: 3_000,
    });
  });
});
