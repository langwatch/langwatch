export const INGESTION_PULL_EVENT_TYPES = {
  CONFIGURED: "lw.obs.ingestion_pull.configured",
  DISABLED: "lw.obs.ingestion_pull.disabled",
  RUN_COMPLETED: "lw.obs.ingestion_pull.run_completed",
  RUN_FAILED: "lw.obs.ingestion_pull.run_failed",
  /**
   * Somebody asked this source to say what agents it has, now.
   *
   * On the same aggregate as the pull rather than a stream of its own: it is
   * the same source, the same credential, and the same provider, and a second
   * aggregate would have to be kept in step with this one's configured and
   * disabled events to know whether the source is still live.
   */
  AGENTS_LISTING_REQUESTED: "lw.obs.ingestion_pull.agents_listing_requested",
  AGENTS_LISTED: "lw.obs.ingestion_pull.agents_listed",
  AGENTS_LISTING_REFUSED: "lw.obs.ingestion_pull.agents_listing_refused",
} as const;

export const INGESTION_PULL_PROCESSING_EVENT_TYPES = [
  INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  INGESTION_PULL_EVENT_TYPES.DISABLED,
  INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
  INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
  INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
  INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
  INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
] as const;

export type IngestionPullProcessingEventType =
  (typeof INGESTION_PULL_PROCESSING_EVENT_TYPES)[number];

export const INGESTION_PULL_COMMAND_TYPES = {
  CONFIGURE: "lw.obs.ingestion_pull.configure",
  DISABLE: "lw.obs.ingestion_pull.disable",
  RECORD_RUN_COMPLETED: "lw.obs.ingestion_pull.record_run_completed",
  RECORD_RUN_FAILED: "lw.obs.ingestion_pull.record_run_failed",
  REQUEST_AGENTS_LISTING: "lw.obs.ingestion_pull.request_agents_listing",
  RECORD_AGENTS_LISTED: "lw.obs.ingestion_pull.record_agents_listed",
  RECORD_AGENTS_LISTING_REFUSED:
    "lw.obs.ingestion_pull.record_agents_listing_refused",
} as const;

export const INGESTION_PULL_PROCESSING_COMMAND_TYPES = [
  INGESTION_PULL_COMMAND_TYPES.CONFIGURE,
  INGESTION_PULL_COMMAND_TYPES.DISABLE,
  INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_COMPLETED,
  INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_FAILED,
  INGESTION_PULL_COMMAND_TYPES.REQUEST_AGENTS_LISTING,
  INGESTION_PULL_COMMAND_TYPES.RECORD_AGENTS_LISTED,
  INGESTION_PULL_COMMAND_TYPES.RECORD_AGENTS_LISTING_REFUSED,
] as const;

export type IngestionPullProcessingCommandType =
  (typeof INGESTION_PULL_PROCESSING_COMMAND_TYPES)[number];

/** Event schema versions using calendar versioning (YYYY-MM-DD). */
export const INGESTION_PULL_EVENT_VERSIONS = {
  CONFIGURED: "2026-07-17",
  DISABLED: "2026-07-17",
  RUN_COMPLETED: "2026-07-17",
  RUN_FAILED: "2026-07-17",
  AGENTS_LISTING_REQUESTED: "2026-09-09",
  AGENTS_LISTED: "2026-09-09",
  AGENTS_LISTING_REFUSED: "2026-09-09",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 *
 * RUN_STATUS moved to 2026-08-28 with `LastSuccessAt` (ADR-128): the column
 * is derivable from the existing event log, so replay backfills it and no
 * source has to fail three more times before its health is knowable.
 */
export const INGESTION_PULL_PROJECTION_VERSIONS = {
  RUN_STATUS: "2026-08-28",
} as const;

export const INGESTION_PULL_RUN_OUTCOME = {
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type IngestionPullRunOutcome =
  (typeof INGESTION_PULL_RUN_OUTCOME)[keyof typeof INGESTION_PULL_RUN_OUTCOME];

/**
 * The refusal reason for a listing that never reached the provider — our own
 * side gave out, after retries. Kept apart from the provider's own reasons
 * (`AgentListingRefusalReason`) so a reader can tell "your credential was
 * rejected" from "we could not ask", and so a later read surface does not
 * offer an admin a fix for a problem they do not have.
 */
export const AGENT_LISTING_FAILED_REASON = "listing_failed";
