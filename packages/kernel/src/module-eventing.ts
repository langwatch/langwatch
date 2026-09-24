/**
 * The seam between a module and the event-sourced half of a process (ADR-144).
 * Composition names no pipeline, projection or subscriber, keeping
 * `@langwatch/eventing` and the Prisma/ioredis/ClickHouse graph off this package.
 */
import type { ServerRole } from "./feature-installer.ts";
import type { ResourceOwnership } from "./resource-scope.ts";

/**
 * Whether this process only sends on a pipeline, or also drains it. The api
 * produces; the worker folds, maps, subscribes and runs process managers —
 * the one branch a declaration reading its own projections is allowed to take.
 */
export type EventingParticipation = "produce" | "consume";

/**
 * Which half the role runs. The worker is the one role that drains: it claims
 * the shared job queue, so every other role sends and drains nothing. No main
 * states this — a process that must differ says so on its own member.
 */
export function participationForRole(role: ServerRole): EventingParticipation {
  return role === "worker" ? "consume" : "produce";
}

/** What a module's eventing declaration is handed when a process installs it. */
export interface FeatureEventingSetup<Repositories, App, ProcessStore> {
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
  readonly resources?: Pick<ResourceOwnership, "own">;
}

/** One aggregate of the reading pipeline's own type; `accepts` keeps the events it declared. */
export interface PriorEventsQuery<Event> {
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly accepts: (event: unknown) => event is Event;
}

/** A command's read of its own aggregate's earlier events, oldest first (WP-5 ruling 2). */
export type PriorEventsRead = <Event>(query: PriorEventsQuery<Event>) => Promise<readonly Event[]>;

/** The one event-log read the kernel takes off a runtime; the kernel binds the aggregate type. */
export interface AggregateEventLog {
  getEvents(
    aggregateId: string,
    context: Readonly<{ tenantId: string }>,
    aggregateType: string,
  ): Promise<readonly unknown[]>;
}

/** The aggregate a built definition declares, read without asserting a shape it may not have. */
function aggregateTypeOf(definition: unknown): string | undefined {
  if (typeof definition !== "object" || definition === null) return void 0;
  if (!("aggregate" in definition)) return void 0;
  const aggregate = definition.aggregate;
  if (typeof aggregate !== "object" || aggregate === null || !("type" in aggregate)) return void 0;
  return typeof aggregate.type === "string" ? aggregate.type : void 0;
}

/** A pipeline's read of its own aggregate, bound to the type its definition declares once built. */
class OwnAggregateHistory {
  #aggregateType: string | undefined;

  constructor(
    private readonly log: () => AggregateEventLog | undefined,
    private readonly pipeline: string,
  ) {}

  readonly read: PriorEventsRead = async ({ tenantId, aggregateId, accepts }) => {
    const aggregateType = this.#aggregateType;
    if (aggregateType === void 0) {
      throw new Error(
        `${this.pipeline} read its earlier events before its definition named an aggregate.`,
      );
    }
    const log = this.log();
    if (log === void 0) {
      throw new Error(
        `${this.pipeline} reads its earlier events, but this process's eventing holds no event log.`,
      );
    }
    const events = await log.getEvents(aggregateId, { tenantId }, aggregateType);
    return events.filter(accepts);
  };

  bindTo(definition: unknown): void {
    if (definition instanceof PendingPipelines) {
      definition.readHistoryFrom(this.log);
      return;
    }
    this.#aggregateType = aggregateTypeOf(definition);
  }
}

/** Builds a module's eventing with each pipeline's read bound to its own aggregate. */
export function buildModuleEventing(input: {
  readonly eventing: FeatureEventing;
  readonly setup: Omit<FeatureEventingSetup<unknown, unknown, unknown>, "priorEvents">;
  readonly log: () => AggregateEventLog | undefined;
}): unknown {
  const history = new OwnAggregateHistory(input.log, input.eventing.pipeline);
  const definition = input.eventing.build({ ...input.setup, priorEvents: history.read });
  history.bindTo(definition);
  return definition;
}

/** What a registered pipeline answers with, as composition reads it back. */
export interface FeatureEventingRegistration {
  readonly commands?: Readonly<Record<string, unknown>>;
}

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
> {
  /** The pipeline's name, so a refusal names it without building anything. */
  readonly pipeline: string;
  build(setup: FeatureEventingSetup<Repositories, App, ProcessStore>): Definition;
  /** What the module does with the senders registration answered with. */
  connect?(bound: Readonly<{ app: App; commands: Readonly<Record<string, unknown>> }>): void;
}

/** The pipelines of a module that called `withEventing` more than once. */
class ModulePipelines implements FeatureEventing {
  readonly pipeline: string;

  constructor(readonly declarations: readonly FeatureEventing[]) {
    this.pipeline = declarations.map((declaration) => declaration.pipeline).join(", ");
  }

  build(setup: FeatureEventingSetup<unknown, unknown, unknown>): PendingPipelines {
    return new PendingPipelines(this.declarations, setup);
  }
}

/** Built one at a time at registration, so each connects before the next builds. */
class PendingPipelines {
  #log: () => AggregateEventLog | undefined = () => void 0;

  constructor(
    private readonly declarations: readonly FeatureEventing[],
    private readonly setup: FeatureEventingSetup<unknown, unknown, unknown>,
  ) {}

  readHistoryFrom(log: () => AggregateEventLog | undefined): void {
    this.#log = log;
  }

  registerEach(register: (definition: unknown) => unknown): void {
    for (const declaration of this.declarations) {
      const definition = buildModuleEventing({
        eventing: declaration,
        setup: this.setup,
        log: this.#log,
      });
      const registration = register(definition);
      declaration.connect?.({ app: this.setup.app, commands: commandsOf(registration) });
    }
  }
}

/** A module's eventing with one more pipeline declared after what it had. */
export function withAnotherPipeline(
  current: FeatureEventing | undefined,
  next: FeatureEventing,
): FeatureEventing {
  if (current === void 0) return next;
  const declared = current instanceof ModulePipelines ? current.declarations : [current];
  return new ModulePipelines([...declared, next]);
}

/**
 * As much of an eventing runtime as installing one module's pipeline needs. A
 * process that runs event sourcing puts one on its pool under `eventing`; a
 * role that does not puts nothing there, and declarations are ignored.
 */
export interface EventingHost {
  readonly participation: EventingParticipation;
  readonly processStore: unknown;
  /** Read at call time: a runtime opens its event store only once it initialises. */
  readonly eventStore?: AggregateEventLog;
  register(definition: unknown): unknown;
  /** The runtime's own maintenance pipelines (blob, process-manager retention). */
  maintenancePipelines?(): readonly unknown[];
}

/** Installs the framework's maintenance pipelines once, where the role drains (WP-6b ruling 2). */
export function installEventingMaintenance(eventing: EventingHost | undefined): void {
  if (eventing === void 0 || eventing.participation !== "consume") return;
  for (const definition of eventing.maintenancePipelines?.() ?? []) eventing.register(definition);
}

/**
 * The eventing runtime a process holds, or nothing. Read by name, the way a
 * repository tier reads `prisma`, so a process running none ignores every
 * declaration. Participation follows the role unless the member states its own.
 */
export function eventingHostFrom(pool: unknown, role: ServerRole): EventingHost | undefined {
  if (typeof pool !== "object" || pool === null) return void 0;
  const candidate = (pool as Readonly<Record<string, unknown>>).eventing;
  if (typeof candidate !== "object" || candidate === null) return void 0;
  const host = candidate as Partial<EventingHost>;
  if (typeof host.register !== "function") return void 0;
  const stated = host.participation;
  return {
    participation:
      stated === "produce" || stated === "consume" ? stated : participationForRole(role),
    processStore: host.processStore,
    get eventStore() {
      return host.eventStore;
    },
    register: registerPipelines(host.register.bind(candidate)),
    ...(typeof host.maintenancePipelines === "function"
      ? { maintenancePipelines: host.maintenancePipelines.bind(candidate) }
      : {}),
  };
}

/** Registers a module's several pipelines one by one, and a single one as it is. */
function registerPipelines(register: (definition: unknown) => unknown) {
  return (definition: unknown): unknown => {
    if (!(definition instanceof PendingPipelines)) return register(definition);
    definition.registerEach(register);
    return {};
  };
}

/** What `register` answered, read back without asserting a shape it may not have. */
export function commandsOf(registration: unknown): Readonly<Record<string, unknown>> {
  if (typeof registration !== "object" || registration === null) return {};
  const commands = (registration as FeatureEventingRegistration).commands;
  if (typeof commands !== "object" || commands === null) return {};
  return commands;
}
