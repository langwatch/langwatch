import { buildIngestionSourceMirror } from "@ee/governance/services/pullers/repositories/ingestionSourceMirror";
import { deriveSourceHealth } from "@ee/governance/services/pullers/sourceHealth";
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

  describe("given a source that is reconfigured while a pull is in flight", () => {
    describe("when the configure event carries a stale cursor snapshot", () => {
      it("keeps the live cursor instead of dragging it backwards", () => {
        // syncIngestionPullSource snapshots pollerCursor at edit time, so a
        // rename or schedule change replays whatever the cursor was THEN.
        const configured = projection.apply(
          projection.init(),
          event("lw.obs.ingestion_pull.configured", {
            sourceId: "source-1",
            cron: "*/15 * * * *",
            configVersion: "v1",
            cursor: "cursor-A",
          }),
        );
        const advanced = projection.apply(
          configured,
          event(
            "lw.obs.ingestion_pull.run_completed",
            {
              sourceId: "source-1",
              runId: "2000",
              scheduledFor: 2_000,
              nextCursor: "cursor-B",
              eventCount: 4,
            },
            2_100,
          ),
        );

        const reconfigured = projection.apply(
          advanced,
          event(
            "lw.obs.ingestion_pull.configured",
            {
              sourceId: "source-1",
              cron: "*/30 * * * *",
              configVersion: "v2",
              cursor: "cursor-A",
            },
            2_200,
          ),
        );

        expect(reconfigured.Cursor).toBe("cursor-B");
        expect(reconfigured.Cron).toBe("*/30 * * * *");
        expect(reconfigured.Enabled).toBe(true);
      });
    });

    describe("when it is the first configure", () => {
      it("seeds the cursor from the event", () => {
        const configured = projection.apply(
          projection.init(),
          event("lw.obs.ingestion_pull.configured", {
            sourceId: "source-1",
            cron: "*/15 * * * *",
            configVersion: "v1",
            cursor: "cursor-seed",
          }),
        );

        expect(configured.Cursor).toBe("cursor-seed");
      });
    });
  });

  describe("given a connected source whose runs report outcomes", () => {
    const configured = projection.apply(
      projection.init(),
      event("lw.obs.ingestion_pull.configured", {
        sourceId: "source-1",
        cron: "*/15 * * * *",
        configVersion: "v1",
        cursor: "cursor-A",
      }),
    );

    const succeed = ({
      state,
      scheduledFor,
      occurredAt,
      eventCount = 3,
    }: {
      state: IngestionPullRunStatusData;
      scheduledFor: number;
      occurredAt: number;
      eventCount?: number;
    }) =>
      projection.apply(
        state,
        event(
          "lw.obs.ingestion_pull.run_completed",
          {
            sourceId: "source-1",
            runId: String(scheduledFor),
            scheduledFor,
            nextCursor: `cursor-${scheduledFor}`,
            eventCount,
          },
          occurredAt,
        ),
      );

    const fail = ({
      state,
      scheduledFor,
      occurredAt,
    }: {
      state: IngestionPullRunStatusData;
      scheduledFor: number;
      occurredAt: number;
    }) =>
      projection.apply(
        state,
        event(
          "lw.obs.ingestion_pull.run_failed",
          {
            sourceId: "source-1",
            runId: String(scheduledFor),
            scheduledFor,
            error: "provider unavailable",
            errorCode: "provider_error",
          },
          occurredAt,
        ),
      );

    describe("when one run fails after a success", () => {
      /** @scenario "A single failed run does not mark the source unhealthy" */
      it("still reads as healthy", () => {
        const succeeded = succeed({
          state: configured,
          scheduledFor: 1_000,
          occurredAt: 1_100,
        });
        const failed = fail({
          state: succeeded,
          scheduledFor: 2_000,
          occurredAt: 2_100,
        });

        expect(failed.ConsecutiveErrors).toBe(1);
        expect(
          deriveSourceHealth({ consecutiveFailures: failed.ConsecutiveErrors }),
        ).toBe("healthy");
      });
    });

    describe("when three runs in a row fail", () => {
      /** @scenario "Three consecutive failed runs mark the source unhealthy" */
      it("reads as unhealthy", () => {
        let state = configured;
        for (const scheduledFor of [1_000, 2_000, 3_000]) {
          state = fail({ state, scheduledFor, occurredAt: scheduledFor + 100 });
        }

        expect(state.ConsecutiveErrors).toBe(3);
        expect(
          deriveSourceHealth({ consecutiveFailures: state.ConsecutiveErrors }),
        ).toBe("unhealthy");
      });
    });

    describe("when a run succeeds after two failures", () => {
      /** @scenario "A successful run records its time and resets the failure count" */
      it("stamps the success time and clears the count", () => {
        const failedTwice = fail({
          state: fail({
            state: configured,
            scheduledFor: 1_000,
            occurredAt: 1_100,
          }),
          scheduledFor: 2_000,
          occurredAt: 2_100,
        });
        expect(failedTwice.LastSuccessAt).toBeNull();

        const recovered = succeed({
          state: failedTwice,
          scheduledFor: 3_000,
          occurredAt: 3_100,
        });

        // A NEW field, not lastEventAt: that one moves whenever data arrives,
        // including on a run that arrived and then failed, so it can never
        // answer "when did we last successfully reach the provider".
        expect(recovered.LastSuccessAt).toBe(3_100);
        expect(recovered.ConsecutiveErrors).toBe(0);
        expect(
          deriveSourceHealth({
            consecutiveFailures: recovered.ConsecutiveErrors,
          }),
        ).toBe("healthy");
      });
    });

    const succeedPartially = ({
      state,
      scheduledFor,
      occurredAt,
      errorCount,
    }: {
      state: IngestionPullRunStatusData;
      scheduledFor: number;
      occurredAt: number;
      errorCount: number;
    }) =>
      projection.apply(
        state,
        event(
          "lw.obs.ingestion_pull.run_completed",
          {
            sourceId: "source-1",
            runId: String(scheduledFor),
            scheduledFor,
            nextCursor: `cursor-${scheduledFor}`,
            eventCount: 3,
            errorCount,
          },
          occurredAt,
        ),
      );

    describe("when a run completes but reports errors alongside its progress", () => {
      /** @scenario "A run that partly succeeded does not reset the failure count" */
      it("leaves the failure count where it was and stamps no success", () => {
        const failedTwice = fail({
          state: fail({
            state: configured,
            scheduledFor: 1_000,
            occurredAt: 1_100,
          }),
          scheduledFor: 2_000,
          occurredAt: 2_100,
        });

        const partial = succeedPartially({
          state: failedTwice,
          scheduledFor: 3_000,
          occurredAt: 3_100,
          errorCount: 2,
        });

        expect(partial.ConsecutiveErrors).toBe(2);
        expect(partial.LastSuccessAt).toBeNull();
        // The progress it DID make still lands: a run only reaches here having
        // advanced its cursor past input it could not read, so dropping the
        // advance would leave the next run re-reading that same input forever.
        expect(partial.Cursor).toBe("cursor-3000");
        expect(partial.LastRunAt).toBe(3_100);
        expect(partial.LastRunOutcome).toBe("completed");
        expect(partial.LastRunEventCount).toBe(3);
        expect(partial.LastRunError).toBeNull();
      });
    });

    describe("when a partly-succeeded run follows a clean one", () => {
      it("does not raise the failure count either", () => {
        const succeeded = succeed({
          state: configured,
          scheduledFor: 1_000,
          occurredAt: 1_100,
        });

        const partial = succeedPartially({
          state: succeeded,
          scheduledFor: 2_000,
          occurredAt: 2_100,
          errorCount: 1,
        });

        expect(partial.ConsecutiveErrors).toBe(0);
        // The earlier clean run's success time stands: this run neither proved
        // the source works nor proved it is broken, so it moves neither field.
        expect(partial.LastSuccessAt).toBe(1_100);
      });
    });

    describe("when a completion predates runs reporting an error count", () => {
      it("folds as the clean run it was", () => {
        // succeed() writes the pre-change event shape -- no errorCount key at
        // all -- which is every completion already on the append-only log.
        const failedOnce = fail({
          state: configured,
          scheduledFor: 1_000,
          occurredAt: 1_100,
        });

        const legacy = succeed({
          state: failedOnce,
          scheduledFor: 2_000,
          occurredAt: 2_100,
        });

        expect(legacy.ConsecutiveErrors).toBe(0);
        expect(legacy.LastSuccessAt).toBe(2_100);
      });
    });

    describe("when a run completes with no new usage for the period", () => {
      /** @scenario "A run that finds nothing new still counts as a success" */
      it("counts as a success and leaves the last-event time alone", () => {
        const empty = succeed({
          state: configured,
          scheduledFor: 1_000,
          occurredAt: 1_100,
          eventCount: 0,
        });

        expect(empty.LastRunOutcome).toBe("completed");
        expect(empty.ConsecutiveErrors).toBe(0);
        expect(empty.LastSuccessAt).toBe(1_100);

        const mirror = buildIngestionSourceMirror({ state: empty });
        expect(mirror.lastSuccessAt).toEqual(new Date(1_100));
        // undefined leaves the column as it was -- an empty run is not data
        // arriving, so nothing about the last event changed.
        expect(mirror.lastEventAt).toBeUndefined();
      });
    });
  });
});
