/**
 * The insight pipeline's names. One aggregate per insight, the project is the tenant, and
 * its owner's seen, done and kept state rides on the same stream.
 * @see modules/insight/adrs/001-insight-aggregate.md
 */

export const INSIGHT_EVENT_TYPES = {
  FILED: "lw.insight.filed",
  SEEN: "lw.insight.seen",
  ARCHIVED: "lw.insight.archived",
  KEPT: "lw.insight.kept",
} as const;

/** Every event the pipeline carries; a read naming these is refetched when one commits. */
export const INSIGHT_PROCESSING_EVENT_TYPES = [
  INSIGHT_EVENT_TYPES.FILED,
  INSIGHT_EVENT_TYPES.SEEN,
  INSIGHT_EVENT_TYPES.ARCHIVED,
  INSIGHT_EVENT_TYPES.KEPT,
] as const;

/** The events the reader projection folds: the owner's own acts. */
export const INSIGHT_READER_EVENT_TYPES = [
  INSIGHT_EVENT_TYPES.SEEN,
  INSIGHT_EVENT_TYPES.ARCHIVED,
  INSIGHT_EVENT_TYPES.KEPT,
] as const;

export const INSIGHT_COMMAND_TYPES = {
  FILE: "lw.insight.file",
  MARK_SEEN: "lw.insight.mark_seen",
  ARCHIVE: "lw.insight.archive",
  KEEP: "lw.insight.keep",
} as const;

/** Event schema versions, calendar versioned. */
export const INSIGHT_EVENT_VERSIONS = {
  FILED: "2026-10-09",
  SEEN: "2026-10-09",
  ARCHIVED: "2026-10-09",
  KEPT: "2026-10-09",
} as const;

/** Projection schema versions, calendar versioned. */
export const INSIGHT_PROJECTION_VERSIONS = {
  INSIGHT: "2026-10-09",
  READER: "2026-10-09",
} as const;

export const INSIGHT_AGGREGATE_TYPE = "insight";

export const INSIGHT_PIPELINE_NAME = "insight_processing";

/** The release flag the inbox, its chrome and its procedures sit behind. */
export const INSIGHTS_FLAG = "release_insights";

/**
 * The daily run pipeline's names. One aggregate per person and board, the project is the
 * tenant, and the run's request, start and outcome ride on its stream.
 * @see modules/insight/adrs/004-daily-run.md
 */
export const INSIGHT_DAILY_RUN_EVENT_TYPES = {
  RUN_REQUESTED: "lw.insight.daily_schedule.run_requested",
  RUN_STARTED: "lw.insight.daily_schedule.run_started",
  RUN_SETTLED: "lw.insight.daily_schedule.run_settled",
} as const;

export const INSIGHT_DAILY_RUN_COMMAND_TYPES = {
  REQUEST_RUN: "lw.insight.daily_schedule.request_run",
  RECORD_RUN_STARTED: "lw.insight.daily_schedule.record_run_started",
  SETTLE_RUN: "lw.insight.daily_schedule.settle_run",
} as const;

/** One calendar version for the three run events. */
export const INSIGHT_DAILY_RUN_EVENT_VERSION = "2026-10-10";

export const INSIGHT_DAILY_SCHEDULE_PROJECTION_VERSION = "2026-10-10";

export const INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE = "insight_daily_schedule";

export const INSIGHT_DAILY_RUN_PIPELINE_NAME = "insight_daily_run";
