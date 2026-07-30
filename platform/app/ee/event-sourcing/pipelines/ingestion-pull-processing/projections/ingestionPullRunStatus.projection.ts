import { z } from "zod";

import {
  INGESTION_PULL_PROJECTION_VERSIONS,
  INGESTION_PULL_RUN_OUTCOME,
} from "../schemas/constants";
import type {
  IngestionPullConfiguredData,
  IngestionPullDisabledData,
  IngestionPullRunCompletedData,
  IngestionPullRunFailedData,
} from "../schemas/events";

export const INGESTION_PULL_RUN_STATUS_PROJECTION = "ingestionPullRunStatus";
export const INGESTION_PULL_RUN_STATUS_VERSION =
  INGESTION_PULL_PROJECTION_VERSIONS.RUN_STATUS;

export const ingestionPullRunStatusSchema = z.object({
  SourceId: z.string(),
  Enabled: z.boolean(),
  Cron: z.string().nullable(),
  Cursor: z.string().nullable(),
  LastRunAt: z.number().nullable(),
  LastRunOutcome: z.string().nullable(),
  LastRunEventCount: z.number(),
  LastRunError: z.string().nullable(),
  LastRunErrorCode: z.string().nullable(),
  ConsecutiveErrors: z.number(),
  /**
   * Which run this row's outcome fields describe, as the run's `scheduledFor`.
   *
   * The process manager fences late outcomes by comparing `runId` against the
   * run it is currently tracking; this read model needs its own fence for the
   * same reason. Runs are scheduled in time order and `runId` is derived from
   * `scheduledFor`, so a strictly smaller `scheduledFor` means the outcome
   * belongs to a superseded run. Without this, run 1 finishing after run 2 had
   * already completed would drag `Cursor` back to run 1's window -- and the
   * store mirrors `Cursor` into `IngestionSource.pollerCursor`, so the
   * compatibility checkpoint would regress and re-ingest that window.
   */
  LastRunScheduledFor: z.number().nullable(),
});
export type IngestionPullRunStatusData = z.infer<
  typeof ingestionPullRunStatusSchema
>;

export function initIngestionPullRunStatus(): IngestionPullRunStatusData {
  return {
    SourceId: "",
    Enabled: false,
    Cron: null,
    Cursor: null,
    LastRunAt: null,
    LastRunOutcome: null,
    LastRunEventCount: 0,
    LastRunError: null,
    LastRunErrorCode: null,
    ConsecutiveErrors: 0,
    LastRunScheduledFor: null,
  };
}

/**
 * Whether an outcome event comes from a run this row has already moved past.
 * Equal `scheduledFor` is accepted: it is the same run reporting, which replay
 * must fold identically.
 */
function isSuperseded(
  state: IngestionPullRunStatusData,
  scheduledFor: number,
): boolean {
  return (
    state.LastRunScheduledFor !== null &&
    scheduledFor < state.LastRunScheduledFor
  );
}

export function applyConfigured(
  state: IngestionPullRunStatusData,
  data: IngestionPullConfiguredData,
): IngestionPullRunStatusData {
  return {
    ...state,
    SourceId: data.sourceId,
    Enabled: true,
    Cron: data.cron,
    // Only the FIRST configure seeds the cursor. A reconfigure carries a
    // cursor snapshotted from IngestionSource.pollerCursor when the edit was
    // made, so adopting it would drag a live cursor backwards whenever
    // someone renames a source or edits its schedule while a pull is in
    // flight -- re-ingesting that window. The process manager fences this
    // exact case; the read model has to agree, because its Cursor is
    // mirrored back into pollerCursor.
    Cursor: state.SourceId ? state.Cursor : data.cursor,
  };
}

export function applyDisabled(
  state: IngestionPullRunStatusData,
  data: IngestionPullDisabledData,
): IngestionPullRunStatusData {
  return {
    ...state,
    SourceId: data.sourceId,
    Enabled: false,
    Cron: null,
  };
}

export function applyRunCompleted(
  state: IngestionPullRunStatusData,
  data: IngestionPullRunCompletedData,
): IngestionPullRunStatusData {
  if (isSuperseded(state, data.scheduledFor)) return state;
  return {
    ...state,
    SourceId: data.sourceId,
    Cursor: data.nextCursor,
    LastRunAt: data.occurredAt,
    LastRunOutcome: INGESTION_PULL_RUN_OUTCOME.COMPLETED,
    LastRunEventCount: data.eventCount,
    LastRunError: null,
    LastRunErrorCode: null,
    ConsecutiveErrors: 0,
    LastRunScheduledFor: data.scheduledFor,
  };
}

export function applyRunFailed(
  state: IngestionPullRunStatusData,
  data: IngestionPullRunFailedData,
): IngestionPullRunStatusData {
  if (isSuperseded(state, data.scheduledFor)) return state;
  return {
    ...state,
    SourceId: data.sourceId,
    LastRunAt: data.occurredAt,
    LastRunOutcome: INGESTION_PULL_RUN_OUTCOME.FAILED,
    LastRunEventCount: 0,
    LastRunError: data.error,
    LastRunErrorCode: data.errorCode,
    ConsecutiveErrors: state.ConsecutiveErrors + 1,
    LastRunScheduledFor: data.scheduledFor,
  };
}
