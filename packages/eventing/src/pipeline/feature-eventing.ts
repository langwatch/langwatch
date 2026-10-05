/**
 * Whether this process only sends on a pipeline, or also drains it: the api produces, the
 * worker folds, maps, subscribes and runs process managers. "describe" builds the consume
 * side to be listed, never run, so it reads the worker's dependencies only when a handler runs.
 */
export type EventingParticipation = "produce" | "consume" | "describe";

/**
 * The seam between a module and the event-sourced half of a process (ADR-144): what a module's
 * eventing declaration is handed when a process installs it. `Resources` is the process's resource
 * owner, supplied by the composing package.
 */
export interface FeatureEventingSetup<Repositories, App, ProcessStore, Resources = unknown> {
  readonly participation: EventingParticipation;
  /** The module's own repositories, on the backend this process selected. */
  readonly repositories: Repositories;
  /** The module's app, already constructed. */
  readonly app: App;
  /** The process state this graph leases and prunes. Another graph's store
   * would prune another process's outbox rows. */
  readonly processStore: ProcessStore;
  /** Earlier events of this pipeline's own aggregate; absent only in a hand-built test setup. */
  readonly priorEvents?: PriorEventsRead;
  /** The module's resource owner: what a consumer builds, it drains on shutdown here. */
  readonly resources?: Resources;
}

/** One aggregate of the reading pipeline's own type; `accepts` keeps the events it declared. */
export interface PriorEventsQuery<Event> {
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly accepts: (event: unknown) => event is Event;
}

/** A command's read of its own aggregate's earlier events, oldest first (WP-5 ruling 2). */
export type PriorEventsRead = <Event>(query: PriorEventsQuery<Event>) => Promise<readonly Event[]>;

/**
 * A module's eventing declaration, with its pipeline's own types erased.
 * `Repositories` and `App` are the module's, so a declaration written against
 * another module's app is not assignable where `.withEventing` takes it.
 */
export interface FeatureEventing<
  Repositories = unknown,
  App = unknown,
  ProcessStore = unknown,
  Definition = unknown,
  Resources = unknown,
> {
  /** The pipeline's name, so a refusal names it without building anything. */
  readonly pipeline: string;
  build(setup: FeatureEventingSetup<Repositories, App, ProcessStore, Resources>): Definition;
  /** What the module does with the senders registration answered with. */
  connect?(bound: Readonly<{ app: App; commands: Readonly<Record<string, unknown>> }>): void;
}

/** A read an event makes stale, and the event data field naming the hint's tenant. */
export type ReadHintTarget = Readonly<{ path: string; scope?: string }>;

/** Committed event type to the reads it makes stale (record §10, read-hints.feature). */
export type ReadHintMap = ReadonlyMap<string, readonly ReadHintTarget[]>;
