import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";

import type {
  IngestionPullConfiguredData,
  IngestionPullDisabledData,
  IngestionPullRunCompletedData,
  IngestionPullRunFailedData,
} from "../../schemas/events";
import {
  applyConfigured,
  applyDisabled,
  applyRunCompleted,
  applyRunFailed,
  type IngestionPullRunStatusData,
  initIngestionPullRunStatus,
} from "../ingestionPullRunStatus.projection";

type FoldEvent =
  | { readonly type: "configured"; readonly data: IngestionPullConfiguredData }
  | { readonly type: "disabled"; readonly data: IngestionPullDisabledData }
  | {
      readonly type: "runCompleted";
      readonly data: IngestionPullRunCompletedData;
    }
  | { readonly type: "runFailed"; readonly data: IngestionPullRunFailedData };

/** Keyed by event, never switched over event — the same shape
 * `.withFold(name, { on: {...} })` mounts in `index.ts`. */
function apply(
  state: IngestionPullRunStatusData,
  event: FoldEvent,
): IngestionPullRunStatusData {
  switch (event.type) {
    case "configured":
      return applyConfigured(state, event.data);
    case "disabled":
      return applyDisabled(state, event.data);
    case "runCompleted":
      return applyRunCompleted(state, event.data);
    case "runFailed":
      return applyRunFailed(state, event.data);
  }
}

const fold = (events: readonly FoldEvent[]): IngestionPullRunStatusData =>
  events.reduce(apply, initIngestionPullRunStatus());

const configured = (
  overrides: Partial<IngestionPullConfiguredData> = {},
): FoldEvent => ({
  type: "configured",
  data: {
    sourceId: "source-1",
    cron: "*/15 * * * *",
    configVersion: "v1",
    cursor: "cursor-1",
    occurredAt: 1_000,
    ...overrides,
  },
});

const completed = (
  overrides: Partial<IngestionPullRunCompletedData> = {},
): FoldEvent => ({
  type: "runCompleted",
  data: {
    sourceId: "source-1",
    runId: "run-1",
    scheduledFor: 1_500,
    nextCursor: "cursor-2",
    eventCount: 3,
    occurredAt: 2_000,
    ...overrides,
  },
});

const failed = (
  overrides: Partial<IngestionPullRunFailedData> = {},
): FoldEvent => ({
  type: "runFailed",
  data: {
    sourceId: "source-1",
    runId: "run-2",
    scheduledFor: 2_000,
    error: "provider unavailable",
    errorCode: "pull_failed",
    retryable: false,
    occurredAt: 3_000,
    ...overrides,
  },
});

describe("the ingestionPullRunStatus fold", () => {
  it("tracks configuration and advances the cursor on completion", () => {
    expect(fold([configured(), completed()])).toMatchObject({
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
    expect(
      fold([completed({ scheduledFor: 1_000, occurredAt: 1_000 }), failed()]),
    ).toMatchObject({
      Cursor: "cursor-2",
      LastRunAt: 3_000,
      LastRunOutcome: "failed",
      LastRunEventCount: 0,
      LastRunError: "provider unavailable",
      ConsecutiveErrors: 1,
    });
  });

  it("remains disabled when a late completion is projected", () => {
    const late = fold([
      {
        type: "disabled",
        data: { sourceId: "source-1", configVersion: "v2", occurredAt: 1_000 },
      },
      completed({ scheduledFor: 1_000, nextCursor: null, eventCount: 1 }),
    ]);
    expect(late.Enabled).toBe(false);
    expect(late.Cron).toBeNull();
  });

  describe("given a run that has been superseded", () => {
    // The scheduler abandons a run it considers stale and starts a fresh one
    // from the same cursor. If the abandoned run then finishes, its outcome
    // must not overwrite the newer one -- the store mirrors Cursor into
    // IngestionSource.pollerCursor, so a regression here re-ingests a window.
    const afterRun2 = fold([
      configured({ cursor: "cursor-A" }),
      completed({
        runId: "2000",
        scheduledFor: 2_000,
        nextCursor: "cursor-B",
        eventCount: 5,
        occurredAt: 2_100,
      }),
    ]);

    describe("when its completion lands after a newer run completed", () => {
      it("does not regress the cursor or the run metadata", () => {
        const stale = apply(
          afterRun2,
          completed({
            runId: "1000",
            scheduledFor: 1_000,
            nextCursor: "cursor-A",
            eventCount: 1,
            occurredAt: 2_200,
          }),
        );

        expect(stale.Cursor).toBe("cursor-B");
        expect(stale.LastRunEventCount).toBe(5);
        expect(stale.LastRunAt).toBe(2_100);
        expect(stale.LastRunScheduledFor).toBe(2_000);
      });
    });

    describe("when its failure lands after a newer run completed", () => {
      it("does not mark the source failed or bump the error count", () => {
        const stale = apply(
          afterRun2,
          failed({
            runId: "1000",
            scheduledFor: 1_000,
            errorCode: "provider_error",
            occurredAt: 2_200,
          }),
        );

        expect(stale.LastRunOutcome).toBe("completed");
        expect(stale.LastRunError).toBeNull();
        expect(stale.ConsecutiveErrors).toBe(0);
        expect(stale.Cursor).toBe("cursor-B");
      });
    });

    describe("when the current run reports again", () => {
      it("still folds, so replay is deterministic", () => {
        const same = apply(
          afterRun2,
          completed({
            runId: "2000",
            scheduledFor: 2_000,
            nextCursor: "cursor-C",
            eventCount: 7,
            occurredAt: 2_300,
          }),
        );

        expect(same.Cursor).toBe("cursor-C");
        expect(same.LastRunEventCount).toBe(7);
      });
    });

    describe("when the two completions are delivered in either order", () => {
      it("lands on the same state, so a re-ordered batch cannot change it", () => {
        const report = checkOrderInvariance({
          init: initIngestionPullRunStatus,
          apply,
          events: [
            completed({
              runId: "2000",
              scheduledFor: 2_000,
              nextCursor: "cursor-B",
              eventCount: 5,
              occurredAt: 2_100,
            }),
            completed({
              runId: "1000",
              scheduledFor: 1_000,
              nextCursor: "cursor-A",
              eventCount: 1,
              occurredAt: 2_200,
            }),
          ],
        });
        expect(report.invariant).toBe(true);
      });
    });
  });

  describe("given a source that is reconfigured while a pull is in flight", () => {
    describe("when the configure event carries a stale cursor snapshot", () => {
      it("keeps the live cursor instead of dragging it backwards", () => {
        // syncIngestionPullSource snapshots pollerCursor at edit time, so a
        // rename or schedule change replays whatever the cursor was THEN.
        const reconfigured = fold([
          configured({ cursor: "cursor-A" }),
          completed({
            runId: "2000",
            scheduledFor: 2_000,
            nextCursor: "cursor-B",
            eventCount: 4,
            occurredAt: 2_100,
          }),
          configured({
            cron: "*/30 * * * *",
            configVersion: "v2",
            cursor: "cursor-A",
            occurredAt: 2_200,
          }),
        ]);

        expect(reconfigured.Cursor).toBe("cursor-B");
        expect(reconfigured.Cron).toBe("*/30 * * * *");
        expect(reconfigured.Enabled).toBe(true);
      });
    });

    describe("when it is the first configure", () => {
      it("seeds the cursor from the event", () => {
        expect(fold([configured({ cursor: "cursor-seed" })]).Cursor).toBe(
          "cursor-seed",
        );
      });
    });
  });
});
