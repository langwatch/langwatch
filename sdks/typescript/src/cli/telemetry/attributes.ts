/**
 * The attribute vocabulary the CLI puts on its live OTEL log records, and the
 * contract the control plane reads them back with.
 *
 * Langy reaches LangWatch by running this CLI in a shell, so a command's
 * mid-flight state is invisible to the panel until the process exits. These
 * attributes are that missing channel: each log record is one beat of a
 * command's life cycle, and the control plane bridges them onto the turn's
 * ephemeral status / progress / metric signals that `StreamingStatusLine` and
 * `StreamingStatCard` already render.
 *
 * The names mirror the CLI's own grammar — `langwatch <resource> <verb>` — so a
 * record identifies itself the same way the tool call that produced it does
 * (see specs/langy/langy-cli-tool-envelope.feature).
 *
 * This vocabulary is a published contract. Add to it freely; renaming or
 * repurposing a key breaks the reader on the other side.
 *
 * Spec: specs/telemetry/langy-live-events.feature
 */

/** Attribute keys carried on every live CLI event. */
export const LANGWATCH_EVENT_ATTRIBUTES = {
  /** The noun the command acts on, e.g. `trace`, `dataset`. */
  resource: "langwatch.resource",
  /** The action the command performs, e.g. `search`, `list`, `export`. */
  verb: "langwatch.verb",
  /** Which beat of the life cycle this record is — see {@link LANGWATCH_EVENTS}. */
  event: "langwatch.event",
  /**
   * The headline integer for the stat card, e.g. the number of matching traces.
   * On a `progress` record it is how many items have been handled so far.
   */
  count: "langwatch.count",
  /** The denominator behind {@link LANGWATCH_EVENT_ATTRIBUTES.count}, when one exists. */
  total: "langwatch.total",
  /** How far along the command is, as a fraction from 0 to 1 inclusive. */
  progress: "langwatch.progress",
  /** A short human sentence for the status line, e.g. "Searching traces…". */
  message: "langwatch.message",
  /** The failure message on an `error` record. Never carries a credential. */
  error: "langwatch.error",
  /**
   * The platform's own name for a failure — the `DomainError.kind` it raised,
   * e.g. `dataset_not_found`. This is the attribute that lets the panel react to
   * a failure instead of merely printing it: a `not_found` can offer to list what
   * does exist, where a sentence can only be read.
   */
  errorKind: "langwatch.error.kind",
  /** The HTTP status the platform answered with. */
  errorStatus: "langwatch.error.http_status",
  /**
   * True when the platform declined the request and said precisely why (the
   * user's problem, actionable). False for infrastructure failures, which are
   * OURS — the panel must not present those as something the user did wrong.
   */
  errorIsDomain: "langwatch.error.domain",
  /** Wall-clock milliseconds the command took, on a `completed` record. */
  durationMs: "langwatch.duration_ms",
} as const;

/** The life-cycle beats a command reports, in the order they occur. */
export const LANGWATCH_EVENTS = {
  /** The command has begun. Carries resource, verb and a human message. */
  started: "started",
  /** A headline number is known, e.g. how many traces matched. Feeds the stat card. */
  count: "count",
  /** The command has advanced. Carries a 0..1 fraction. Feeds the progress bar. */
  progress: "progress",
  /** The command finished successfully. Carries the final count and a duration. */
  completed: "completed",
  /** The command failed. Carries a redacted failure message. */
  error: "error",
} as const;

export type LangWatchEvent =
  (typeof LANGWATCH_EVENTS)[keyof typeof LANGWATCH_EVENTS];

/**
 * Switches the OTLP transport on. Unset (or any value other than a truthy one)
 * means the CLI never builds an exporter and never opens a socket. An OTLP logs
 * endpoint must also be configured — see `resolveLogsEndpoint`.
 */
export const LANGWATCH_OTEL_EVENTS_ENV = "LANGWATCH_OTEL_EVENTS";

/**
 * Path to a unix socket the host is listening on. Its presence is its own
 * enablement — a host only sets this when it wants the events — and it takes
 * precedence over OTLP, being both cheaper to load and faster to deliver.
 */
export const LANGWATCH_EVENTS_SOCKET_ENV = "LANGWATCH_EVENTS_SOCKET";

/** The OTEL scope every live CLI event is emitted under. */
export const LANGWATCH_EVENTS_SCOPE = "langwatch.cli.events";
