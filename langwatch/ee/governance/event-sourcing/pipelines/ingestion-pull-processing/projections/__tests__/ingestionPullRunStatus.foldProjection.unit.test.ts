import { describe, expect, it } from "vitest";

import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { IngestionPullProcessingEvent } from "../../schemas/events";
import {
  type IngestionPullRunStatusData,
  IngestionPullRunStatusFoldProjection,
} from "../ingestionPullRunStatus.foldProjection";

const projection = new IngestionPullRunStatusFoldProjection({
  store: {
    load: async () => null,
    store: async () => undefined,
  } as StateProjectionStore<IngestionPullRunStatusData>,
});

function event(
  type: IngestionPullProcessingEvent["type"],
  data: unknown,
  occurredAt = 1_000,
): IngestionPullProcessingEvent {
  return {
    id: `event-${type}-${occurredAt}`,
    aggregateId: "source-1",
    aggregateType: "ingestion_pull",
    tenantId: "gov-project",
    createdAt: occurredAt,
    occurredAt,
    version: "2026-07-17",
    type,
    data,
  } as IngestionPullProcessingEvent;
}

describe("IngestionPullRunStatusFoldProjection", () => {
  it("tracks configuration and advances the cursor on completion", () => {
    let state = projection.apply(
      projection.init(),
      event("lw.obs.ingestion_pull.configured", {
        sourceId: "source-1",
        cron: "*/15 * * * *",
        configVersion: "v1",
        cursor: "cursor-1",
      }),
    );
    state = projection.apply(
      state,
      event(
        "lw.obs.ingestion_pull.run_completed",
        {
          sourceId: "source-1",
          runId: "run-1",
          scheduledFor: 1_500,
          nextCursor: "cursor-2",
          eventCount: 3,
        },
        2_000,
      ),
    );

    expect(state).toMatchObject({
      SourceId: "source-1",
      Enabled: true,
      Cron: "*/15 * * * *",
      Cursor: "cursor-2",
      LastRunAt: 2_000,
      LastRunOutcome: "completed",
      LastRunEventCount: 3,
      ConsecutiveErrors: 0,
    });
  });

  it("keeps the cursor and resets last-run event count on failure", () => {
    const completed = projection.apply(
      projection.init(),
      event("lw.obs.ingestion_pull.run_completed", {
        sourceId: "source-1",
        runId: "run-1",
        scheduledFor: 1_000,
        nextCursor: "cursor-2",
        eventCount: 3,
      }),
    );
    const failed = projection.apply(
      completed,
      event(
        "lw.obs.ingestion_pull.run_failed",
        {
          sourceId: "source-1",
          runId: "run-2",
          scheduledFor: 2_000,
          error: "provider unavailable",
          errorCode: "pull_failed",
          retryable: true,
        },
        3_000,
      ),
    );

    expect(failed).toMatchObject({
      Cursor: "cursor-2",
      LastRunAt: 3_000,
      LastRunOutcome: "failed",
      LastRunEventCount: 0,
      LastRunError: "provider unavailable",
      ConsecutiveErrors: 1,
    });
  });

  it("remains disabled when a late completion is projected", () => {
    const disabled = projection.apply(
      projection.init(),
      event("lw.obs.ingestion_pull.disabled", {
        sourceId: "source-1",
        configVersion: "v2",
      }),
    );
    const late = projection.apply(
      disabled,
      event("lw.obs.ingestion_pull.run_completed", {
        sourceId: "source-1",
        runId: "run-1",
        scheduledFor: 1_000,
        nextCursor: null,
        eventCount: 1,
      }),
    );

    expect(late.Enabled).toBe(false);
    expect(late.Cron).toBeNull();
  });
});
