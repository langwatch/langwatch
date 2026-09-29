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
  /**
   * The same three, for the people a source's provider lists.
   *
   * Their own event types rather than one listing event with an entity field.
   * A reader asking "when did we last learn who works here" should not have to
   * filter a mixed stream, and the two lists refuse for different reasons at
   * different times: a credential can be entitled to enumerate agents and not
   * people, which is one event saying refused and another saying listed on the
   * same source in the same minute.
   */
  PEOPLE_LISTING_REQUESTED: "lw.obs.ingestion_pull.people_listing_requested",
  PEOPLE_LISTED: "lw.obs.ingestion_pull.people_listed",
  PEOPLE_LISTING_REFUSED: "lw.obs.ingestion_pull.people_listing_refused",
} as const;

export const INGESTION_PULL_PROCESSING_EVENT_TYPES = [
  INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  INGESTION_PULL_EVENT_TYPES.DISABLED,
  INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
  INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
  INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
  INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
  INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
  INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED,
  INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED,
  INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REFUSED,
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
  REQUEST_PEOPLE_LISTING: "lw.obs.ingestion_pull.request_people_listing",
  RECORD_PEOPLE_LISTED: "lw.obs.ingestion_pull.record_people_listed",
  RECORD_PEOPLE_LISTING_REFUSED:
    "lw.obs.ingestion_pull.record_people_listing_refused",
} as const;

export const INGESTION_PULL_PROCESSING_COMMAND_TYPES = [
  INGESTION_PULL_COMMAND_TYPES.CONFIGURE,
  INGESTION_PULL_COMMAND_TYPES.DISABLE,
  INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_COMPLETED,
  INGESTION_PULL_COMMAND_TYPES.RECORD_RUN_FAILED,
  INGESTION_PULL_COMMAND_TYPES.REQUEST_AGENTS_LISTING,
  INGESTION_PULL_COMMAND_TYPES.RECORD_AGENTS_LISTED,
  INGESTION_PULL_COMMAND_TYPES.RECORD_AGENTS_LISTING_REFUSED,
  INGESTION_PULL_COMMAND_TYPES.REQUEST_PEOPLE_LISTING,
  INGESTION_PULL_COMMAND_TYPES.RECORD_PEOPLE_LISTED,
  INGESTION_PULL_COMMAND_TYPES.RECORD_PEOPLE_LISTING_REFUSED,
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
  PEOPLE_LISTING_REQUESTED: "2026-09-09",
  PEOPLE_LISTED: "2026-09-09",
  PEOPLE_LISTING_REFUSED: "2026-09-09",
} as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 *
 * RUN_STATUS moved to 2026-08-28 with `LastSuccessAt` (ADR-128): the column
 * is derivable from the existing event log, so replay backfills it and no
 * source has to fail three more times before its health is knowable.
 *
 * RUN_STATUS deliberately did NOT move when the listing columns and the
 * read-through and completeness columns were added, and the reason is the
 * same test that moved it last time: a bump says replay will produce
 * different rows. Neither change makes that true. The listing events are new,
 * so no history holds one to fold; the read-through and completeness fields
 * are optional additions to run-completed, so events already written do not
 * carry them. A replay would cost a full pass over the log and change
 * nothing, while telling whoever ran it that something was recovered.
 *
 * Every one of those columns is nullable and null is a meaningful reading of
 * each: no listing has been recorded for this source, and the completeness of
 * the last run is unknown. That is the truth for a source whose history
 * predates the columns, so leaving the rows alone states it correctly.
 *
 * Move this the day a listing column becomes derivable from events already in
 * the log.
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
 * What the last listing of one kind did, as stored on the run-status row.
 *
 * Kept apart from `INGESTION_PULL_RUN_OUTCOME` rather than sharing its values,
 * because a listing and a pull are different scopes on the same connection: a
 * credential that cannot enumerate a directory still pulls cost perfectly. Two
 * vocabularies make it impossible to write a listing outcome into a pull
 * column, or to read one as the source having failed to pull.
 *
 * There is no `empty` here on purpose. An empty directory is a LISTED outcome
 * with a count of zero, which is a real answer from a working provider. A
 * refusal is the outcome that has no count at all.
 */
export const INGESTION_PULL_LISTING_OUTCOME = {
  LISTED: "listed",
  REFUSED: "refused",
} as const;
export type IngestionPullListingOutcome =
  (typeof INGESTION_PULL_LISTING_OUTCOME)[keyof typeof INGESTION_PULL_LISTING_OUTCOME];

/**
 * The refusal reason for a listing that never reached the provider — our own
 * side gave out, after retries. Kept apart from the provider's own reasons
 * (`ListingRefusalReason`) so a reader can tell "your credential was rejected"
 * from "we could not ask", and so a later read surface does not offer an admin
 * a fix for a problem they do not have.
 *
 * One value for both listings: what failed is our side, which knows nothing
 * about whether it was asking for agents or for people.
 */
export const LISTING_FAILED_REASON = "listing_failed";

/**
 * The name this pipeline is registered under, and the name a caller has to
 * dispatch against to reach it.
 *
 * It lives here rather than in `pipeline.ts` because a caller outside this
 * directory needs it, and importing it from `pipeline.ts` would pull the
 * commands, the projection and the whole process manager into every
 * request-serving process, including ones where event sourcing is off. This
 * file imports nothing, so naming the pipeline costs a caller nothing.
 *
 * The point of exporting it at all: a copied string literal turns a rename
 * into a runtime refusal on somebody's first button press, rather than a
 * compile error here.
 */
export const INGESTION_PULL_PROCESSING_PIPELINE_NAME =
  "ingestion_pull_processing";
