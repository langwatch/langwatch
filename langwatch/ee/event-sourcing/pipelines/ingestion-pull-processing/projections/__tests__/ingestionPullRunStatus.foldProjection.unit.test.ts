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

  describe("given a run that has been superseded", () => {
    // The scheduler abandons a run it considers stale and starts a fresh one
    // from the same cursor. If the abandoned run then finishes, its outcome
    // must not overwrite the newer one -- the repository mirrors Cursor into
    // IngestionSource.pollerCursor, so a regression here re-ingests a window.
    const configured = projection.apply(
      projection.init(),
      event("lw.obs.ingestion_pull.configured", {
        sourceId: "source-1",
        cron: "*/15 * * * *",
        configVersion: "v1",
        cursor: "cursor-A",
      }),
    );
    const afterRun2 = projection.apply(
      configured,
      event(
        "lw.obs.ingestion_pull.run_completed",
        {
          sourceId: "source-1",
          runId: "2000",
          scheduledFor: 2_000,
          nextCursor: "cursor-B",
          eventCount: 5,
        },
        2_100,
      ),
    );

    describe("when its completion lands after a newer run completed", () => {
      it("does not regress the cursor or the run metadata", () => {
        const stale = projection.apply(
          afterRun2,
          event(
            "lw.obs.ingestion_pull.run_completed",
            {
              sourceId: "source-1",
              runId: "1000",
              scheduledFor: 1_000,
              nextCursor: "cursor-A",
              eventCount: 1,
            },
            2_200,
          ),
        );

        expect(stale.Cursor).toBe("cursor-B");
        expect(stale.LastRunEventCount).toBe(5);
        expect(stale.LastRunAt).toBe(2_100);
        expect(stale.LastRunScheduledFor).toBe(2_000);
      });
    });

    describe("when its failure lands after a newer run completed", () => {
      it("does not mark the source failed or bump the error count", () => {
        const stale = projection.apply(
          afterRun2,
          event(
            "lw.obs.ingestion_pull.run_failed",
            {
              sourceId: "source-1",
              runId: "1000",
              scheduledFor: 1_000,
              error: "provider unavailable",
              errorCode: "provider_error",
            },
            2_200,
          ),
        );

        expect(stale.LastRunOutcome).toBe("completed");
        expect(stale.LastRunError).toBeNull();
        expect(stale.ConsecutiveErrors).toBe(0);
        expect(stale.Cursor).toBe("cursor-B");
      });
    });

    describe("when the current run reports again", () => {
      it("still folds, so replay is deterministic", () => {
        const same = projection.apply(
          afterRun2,
          event(
            "lw.obs.ingestion_pull.run_completed",
            {
              sourceId: "source-1",
              runId: "2000",
              scheduledFor: 2_000,
              nextCursor: "cursor-C",
              eventCount: 7,
            },
            2_300,
          ),
        );

        expect(same.Cursor).toBe("cursor-C");
        expect(same.LastRunEventCount).toBe(7);
      });
    });
  });
});
