/**
 * Event and command type constants for the evaluation-processing pipeline.
 */

/**
 * Event type identifiers used for routing and filtering events.
 * Format: "lw.<domain>.<action>"
 */
export const EVALUATION_EVENT_TYPES = {
  /**
   * RETIRED — nothing emits this any more.
   *
   * It is kept registered because both `evaluationRun.foldProjection` and
   * `evaluationAnalytics.foldProjection` still fold it, and events already
   * committed under this type must still parse when the log is read. Its Zod
   * schema and the `z.literal` built from this identifier are load-bearing for
   * replay. Delete it only once no log within retention can contain one.
   */
  SCHEDULED: "lw.evaluation.scheduled",
  /**
   * RETIRED — nothing emits this any more. Kept for the same reason as
   * `SCHEDULED`: both evaluation folds still handle it, so historical events
   * must keep parsing on replay.
   */
  STARTED: "lw.evaluation.started",
  /**
   * RETIRED as an *emitted* event — nothing produces one any more, and the
   * lifecycle now lands as a single `REPORTED`. The identifier itself is very
   * much alive on the read side: both evaluation folds handle it and
   * `evaluationAlertTriggerMatch.subscriber` subscribes to it, so historical
   * events must keep parsing on replay.
   */
  COMPLETED: "lw.evaluation.completed",
  REPORTED: "lw.evaluation.reported",
} as const;

export const EVALUATION_COMPLETED_EVENT_TYPE = EVALUATION_EVENT_TYPES.COMPLETED;
export const EVALUATION_REPORTED_EVENT_TYPE = EVALUATION_EVENT_TYPES.REPORTED;

/**
 * Event schema versions using calendar versioning (YYYY-MM-DD). The date
 * records when the shape was introduced, not when any event occurred.
 *
 * What these versions actually are, and are not:
 *
 * They are a COMPILE-TIME constraint on the MINT SITE. Each event schema
 * asserts its version as a literal (`z.literal(EVALUATION_EVENT_VERSIONS.X)`),
 * and the event type is `z.infer`'d from that schema, so a command handler
 * cannot construct one of these events at any other version — TypeScript
 * rejects it. Alongside that, the map is a documentation trail: the whole
 * history of what can be in the log for these four types, each of which has
 * shipped exactly one version and has been minted from this map (or an alias
 * of it) since the type was introduced.
 *
 * They are NOT a read-time compatibility mechanism. Nothing on the read path
 * validates or branches on `version`. Materialisation is an unvalidated cast in
 * every case — `stores/eventStoreUtils.recordToEvent` returns `event as
 * EventType` over an `unknown` payload, and `replay/replayEventLoader` and
 * `queues/groupQueue/bodyCodec` do the same — and `abstractFoldProjection.apply`
 * dispatches on `event.type` alone and never reads `event.version`. Reading a
 * historical event therefore reinterprets whatever bytes are in the log as the
 * CURRENT shape, whatever version string the row carries.
 *
 * The consequence for changing an event: a version bump buys you nothing at
 * read time. Add or widen a field only when every already-committed payload
 * still makes sense read as the new shape (an added optional field does; a
 * required one does not, since old rows lack it and no parse would ever reject
 * them). An incompatible payload change needs a NEW EVENT TYPE — the read path
 * does dispatch on type — not a new version. Add a version alongside the old
 * one (widening the schema's assertion to a union) to mark a compatible change;
 * replacing a value here would make the mint site disagree with the whole
 * committed history.
 */
export const EVALUATION_EVENT_VERSIONS = {
  /** Initial schema version introduced with event sourcing feature */
  SCHEDULED: "2025-01-14",
  /** Initial schema version introduced with event sourcing feature */
  STARTED: "2025-01-14",
  /** Initial schema version introduced with event sourcing feature */
  COMPLETED: "2025-01-14",
  /** Initial schema version for single-event custom SDK evaluations */
  REPORTED: "2025-01-14",
} as const;

export const EVALUATION_REPORTED_EVENT_VERSION_LATEST =
  EVALUATION_EVENT_VERSIONS.REPORTED;

export const EVALUATION_PROCESSING_EVENT_TYPES = [
  EVALUATION_EVENT_TYPES.SCHEDULED,
  EVALUATION_EVENT_TYPES.STARTED,
  EVALUATION_EVENT_TYPES.COMPLETED,
  EVALUATION_EVENT_TYPES.REPORTED,
] as const;

/**
 * Command type identifiers used for routing commands to handlers.
 * Format: "lw.<domain>.<action>"
 */
const EVALUATION_COMMAND_TYPES = {
  EXECUTE: "lw.evaluation.execute",
  START: "lw.evaluation.start",
  COMPLETE: "lw.evaluation.complete",
  REPORT: "lw.evaluation.report",
} as const;

export const EXECUTE_EVALUATION_COMMAND_TYPE = EVALUATION_COMMAND_TYPES.EXECUTE;

export const EVALUATION_PROCESSING_COMMAND_TYPES = [
  EVALUATION_COMMAND_TYPES.EXECUTE,
  EVALUATION_COMMAND_TYPES.START,
  EVALUATION_COMMAND_TYPES.COMPLETE,
  EVALUATION_COMMAND_TYPES.REPORT,
] as const;

/**
 * Projection schema versions using calendar versioning (YYYY-MM-DD).
 *
 * These versions indicate the schema version of the projection data structure.
 * When the projection schema changes, projections may need to be rebuilt from
 * events to apply the new schema.
 */
export const EVALUATION_PROJECTION_VERSIONS = {
  /** Initial projection schema version */
  STATE: "2025-01-14",
} as const;
