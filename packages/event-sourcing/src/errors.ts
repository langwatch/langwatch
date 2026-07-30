/**
 * The core raises no `HandledError`: its callers are workers, and none of these
 * failures has a customer-facing remedy (ADR-045). Every error carries a
 * `context` object that reaches the log line as fields, so a failure is
 * queryable by attribute rather than by matching on message prose.
 */

export type ErrorContext = Readonly<Record<string, unknown>>;

/** Base for every error the package raises. Never customer-facing. */
export class EventSourcingError extends Error {
  readonly context: ErrorContext;

  constructor(message: string, context: ErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.context = context;
  }
}

/**
 * A pipeline is assembled wrongly — a duplicate projection name, a fold mounted
 * on a scope that cannot serialise it, a batch size on a lane that can never
 * form a batch.
 *
 * These are thrown at composition time, before any event is processed, so they
 * fail a deploy rather than corrupting state. That is the whole point of
 * checking them at mount: a fold on an event-scoped lane would interleave
 * read-modify-write cycles and lose updates, and it would do so quietly.
 */
export class ConfigurationError extends EventSourcingError {}

/**
 * A stored projection row exists but cannot be decoded into the shape the
 * current projection version expects.
 *
 * This is deliberately not treated as "no state" (ADR-098). Reading it as
 * genesis would fold the next event onto a fresh accumulator and write that
 * over live state, so the first deploy that changed a fold's shape would reset
 * every aggregate it touched. Failing loudly stops one aggregate; the
 * alternative silently destroys all of them.
 */
export class UndecodableStateError extends EventSourcingError {
  constructor(args: {
    projectionName: string;
    aggregateId: string;
    storedVersion: string | undefined;
    expectedVersion: string;
    cause?: unknown;
  }) {
    super(
      `projection "${args.projectionName}" cannot decode stored state`,
      {
        projectionName: args.projectionName,
        aggregateId: args.aggregateId,
        storedVersion: args.storedVersion ?? null,
        expectedVersion: args.expectedVersion,
      },
    );
    if (args.cause !== undefined) this.cause = args.cause;
  }
}

/**
 * A rendered group key does not parse. An internal invariant violation: every
 * key the package produces round-trips, so an unparseable one means a key was
 * built somewhere other than the renderer.
 */
export class MalformedGroupKeyError extends EventSourcingError {
  constructor(rendered: string, reason: string) {
    super(`malformed group key (${reason})`, { rendered, reason });
  }
}
