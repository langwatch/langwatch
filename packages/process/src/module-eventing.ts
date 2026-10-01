/**
 * The seam between a module and the event-sourced half of a process (ADR-144).
 * The declaration types live in `@langwatch/eventing`; composition names no
 * pipeline, projection or subscriber and imports those types only.
 */
import type {
  EventingParticipation,
  FeatureEventingSetup,
  FeatureEventing,
  PriorEventsRead,
  ReadHintTarget,
  ReadHintMap,
} from "@langwatch/eventing";
import type { TrpcContract, TrpcContractMember } from "@langwatch/module";

import type { ServerRole } from "./feature-installer.ts";
import type { RuntimeService } from "./runtime-lifecycle.ts";
import type { DeclaredTransports } from "./transport-mounting.ts";

/**
 * Which half the role runs. The worker is the one role that drains: it claims
 * the shared job queue, so every other role sends and drains nothing. No main
 * states this — a process that must differ says so on its own member.
 */
export function participationForRole(role: ServerRole): EventingParticipation {
  return role === "worker" ? "consume" : "produce";
}

/** The one event-log read the kernel takes off a runtime; the kernel binds the aggregate type. */
export interface AggregateEventLog {
  getEvents(request: {
    aggregateId: string;
    context: Readonly<{ tenantId: string }>;
    aggregateType: string;
  }): Promise<readonly unknown[]>;
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
    const events = await log.getEvents({ aggregateId, context: { tenantId }, aggregateType });
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

  describeEach(describe: (definition: unknown) => void): void {
    for (const declaration of this.declarations) {
      describe(buildModuleEventing({ eventing: declaration, setup: this.setup, log: this.#log }));
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
  /** Lists a definition without starting it; absent on a runtime that cannot describe. */
  describe?(definition: unknown): void;
  /** The runtime's own maintenance pipelines (blob, process-manager retention). */
  maintenancePipelines?(): readonly unknown[];
  /** The one subscriber turning committed events into read hints; absent where none can publish. */
  readHintPipeline?(hinted: ReadHintMap): unknown;
  /** Every projection name the registered pipelines declare; absent where none can be listed. */
  projectionNames?(): ReadonlySet<string>;
  /** Keeps what registration would start idle until `startConsumers`. */
  holdConsumers?(): void;
  /** Starts consuming; the kernel calls it when the booted runtime starts. */
  startConsumers?(): void;
}

/**
 * Installs the framework's maintenance pipelines once, where the role drains (WP-6b ruling 2).
 * A role that sends only describes them, so the operator console lists what the worker runs.
 */
export function installEventingMaintenance(eventing: EventingHost | undefined): void {
  if (eventing === void 0) return;
  const definitions = eventing.maintenancePipelines?.() ?? [];
  if (eventing.participation === "consume") {
    for (const definition of definitions) eventing.register(definition);
    return;
  }
  for (const definition of definitions) eventing.describe?.(definition);
}

/** Every installed read naming an event, keyed by that event. */
export function readHintsOf({ contracts }: { contracts: readonly TrpcContract[] }): ReadHintMap {
  const hinted = new Map<string, ReadHintTarget[]>();
  for (const { namespace, members } of contracts) {
    for (const [name, member] of Object.entries(members)) {
      for (const invalidation of member.invalidatedBy ?? []) {
        const path = `${namespace}.${name}`;
        const event = typeof invalidation === "string" ? invalidation : invalidation.event;
        const target: ReadHintTarget =
          typeof invalidation === "string" ? { path } : { path, scope: invalidation.scope };
        hinted.set(event, [...(hinted.get(event) ?? []), target]);
      }
    }
  }
  return hinted;
}

/** A read a projection's cursor answers, and the input field addressing the key row, if any. */
export type ProjectionReadTarget = Readonly<{ path: string; key?: string }>;

/** Projection name to the reads served from it (projection-cursor-reads.feature). */
export type ProjectionReadMap = ReadonlyMap<string, readonly ProjectionReadTarget[]>;

/** A cursor-backed read the installed contracts cannot honour, refused at boot. */
export class ProjectionReadError extends Error {
  override readonly name = "ProjectionReadError";

  constructor(
    readonly code: "read_cursor_and_hints" | "read_unknown_projection",
    readonly paths: readonly string[],
    message: string,
  ) {
    super(message);
  }
}

/** The (projection, target) pairs one read declares; refuses a read that also declares hints. */
function projectionSourcesOf({
  path,
  member,
}: {
  path: string;
  member: TrpcContractMember;
}): [string, ProjectionReadTarget][] {
  if (member.fromProjection === void 0) return [];
  if (member.invalidatedBy !== void 0) {
    throw new ProjectionReadError(
      "read_cursor_and_hints",
      [path],
      `Read "${path}" declares both fromProjection and invalidatedBy; its hints come from the cursor advance.`,
    );
  }
  return member.fromProjection.map((source) =>
    typeof source === "string"
      ? [source, { path }]
      : [source.projection, { path, key: source.key }],
  );
}

/** Every installed read served from a projection, keyed by that projection. */
export function projectionReadsOf({
  contracts,
}: {
  contracts: readonly TrpcContract[];
}): ProjectionReadMap {
  const served = new Map<string, ProjectionReadTarget[]>();
  const reads = contracts.flatMap(({ namespace, members }) =>
    Object.entries(members).map(([name, member]) => ({ path: `${namespace}.${name}`, member })),
  );
  for (const read of reads) {
    for (const [projection, target] of projectionSourcesOf(read)) {
      served.set(projection, [...(served.get(projection) ?? []), target]);
    }
  }
  return served;
}

function isTrpcContract(value: unknown): value is TrpcContract {
  return (
    typeof value === "object" &&
    value !== null &&
    "namespace" in value &&
    typeof value.namespace === "string" &&
    "members" in value &&
    typeof value.members === "object" &&
    value.members !== null
  );
}

/** The tRPC contracts the installed modules declared, read off their transports. */
function trpcContractsOf(declared: readonly DeclaredTransports[]): TrpcContract[] {
  return declared.flatMap(({ transports }) =>
    transports.flatMap((transport) =>
      transport.protocol === "trpc" && "contract" in transport && isTrpcContract(transport.contract)
        ? [transport.contract]
        : [],
    ),
  );
}

/**
 * Registers the read-hint subscriber once, after every module installed, in every role: a
 * global subscriber is staged where an event is appended, the api included.
 */
export function installReadHints({
  eventing,
  declared,
}: {
  eventing: EventingHost | undefined;
  declared: readonly DeclaredTransports[];
}): void {
  if (eventing?.readHintPipeline === void 0) return;
  const hinted = readHintsOf({ contracts: trpcContractsOf(declared) });
  if (hinted.size === 0) return;
  const definition = eventing.readHintPipeline(hinted);
  if (definition !== void 0) eventing.register(definition);
}

/**
 * Refuses a cursor-backed read naming a projection no installed pipeline declares, as a read
 * hint naming an undeclared event is refused. A runtime that cannot list projections skips it.
 */
export function installProjectionReads({
  eventing,
  declared,
}: {
  eventing: EventingHost | undefined;
  declared: readonly DeclaredTransports[];
}): void {
  const reads = projectionReadsOf({ contracts: trpcContractsOf(declared) });
  const known = eventing?.projectionNames?.();
  if (reads.size === 0 || known === void 0) return;
  const unknown = [...reads].filter(([projection]) => !known.has(projection));
  if (unknown.length === 0) return;
  throw new ProjectionReadError(
    "read_unknown_projection",
    unknown.flatMap(([, targets]) => targets.map(({ path }) => path)),
    `A read names a projection no installed pipeline declares: ${unknown
      .map(
        ([projection, targets]) => `${projection} (${targets.map(({ path }) => path).join(", ")})`,
      )
      .join("; ")}`,
  );
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
    ...(typeof host.describe === "function"
      ? { describe: describePipelines(host.describe.bind(candidate)) }
      : {}),
    ...(typeof host.maintenancePipelines === "function"
      ? { maintenancePipelines: host.maintenancePipelines.bind(candidate) }
      : {}),
    ...(typeof host.readHintPipeline === "function"
      ? { readHintPipeline: host.readHintPipeline.bind(candidate) }
      : {}),
    ...(typeof host.projectionNames === "function"
      ? { projectionNames: host.projectionNames.bind(candidate) }
      : {}),
    ...(typeof host.holdConsumers === "function" && typeof host.startConsumers === "function"
      ? {
          holdConsumers: host.holdConsumers.bind(candidate),
          startConsumers: host.startConsumers.bind(candidate),
        }
      : {}),
  };
}

/**
 * Holds the runtime's consumers through construction and starts them with the
 * booted runtime, after every module installed and every peer API is ready.
 */
export function eventingConsumers(eventing: EventingHost | undefined): RuntimeService[] {
  if (eventing?.holdConsumers === void 0 || eventing.startConsumers === void 0) return [];
  eventing.holdConsumers();
  // The eventing member closes what these consumers opened, after the drain.
  return [
    { name: "eventing consumers", start: () => eventing.startConsumers?.(), stop: () => void 0 },
  ];
}

/** Registers a module's several pipelines one by one, and a single one as it is. */
function registerPipelines(register: (definition: unknown) => unknown) {
  return (definition: unknown): unknown => {
    if (!(definition instanceof PendingPipelines)) return register(definition);
    definition.registerEach(register);
    return {};
  };
}

/** Describes a module's several pipelines one by one, and a single one as it is. */
function describePipelines(describe: (definition: unknown) => void) {
  return (definition: unknown): void => {
    if (!(definition instanceof PendingPipelines)) return describe(definition);
    definition.describeEach(describe);
  };
}

/** What `register` answered, read back without asserting a shape it may not have. */
export function commandsOf(registration: unknown): Readonly<Record<string, unknown>> {
  if (typeof registration !== "object" || registration === null) return {};
  const commands = (registration as FeatureEventingRegistration).commands;
  if (typeof commands !== "object" || commands === null) return {};
  return commands;
}
