import type { z } from "zod";
import { ConfigurationError } from "../errors";
import type { CollapseKind, Mount, ScopeKind } from "../mount/mount.types";
import { validateMount } from "../mount/validateMount";
import type { Metrics } from "../ports/metrics";
import { createFoldExecutor } from "../projections/foldExecutor";
import { createMapExecutor } from "../projections/mapExecutor";
import type { AppendStore, MergeStore, ReplaceStore } from "../projections/store.types";
import type {
  BuiltCommand,
  BuiltFold,
  BuiltMap,
  BuiltPipeline,
  BuiltProcessManager,
  BuiltProcessManagerIntent,
  BuiltSubscriber,
  EmittedEvent,
  EventSchemaMap,
  EvolveStep,
  FoldHandlerMap,
  HandlerContext,
  IdMap,
  IntentMap,
  MapHandlerMap,
  MappedRow,
  ProcessContext,
  ProcessManagerHandlerMap,
  SubscriberHandlerMap,
  WireEvent,
} from "./pipeline.types";
import { resolveStateVersion } from "./stateVersion";
import {
  assertKeyIsSafe,
  assertNoSeparators,
  assertPrefixIsSafe,
  eventTypeOf,
  intentTypeOf,
} from "./typeStrings";
import { resolveDispatch, wireHandler } from "./wireDispatch";

/** The one port a pipeline's members share, supplied once at `.build()` rather
 * than per mount — a store is built per mount because each is infrastructure
 * of its own, but metrics is one registry for the whole pipeline. Absent
 * means every counter and histogram a fold or map records is a no-op. */
export interface PipelinePorts {
  readonly metrics?: Metrics;
}

/**
 * `definePipeline` (ADR-105 decision 1). One chain: a name, an optional
 * prefix, the event vocabulary, an optional aggregate id, then any number of
 * commands / folds / maps / process managers / subscribers, then `.build()`.
 *
 * `.withFold` and `.withProcessManager` exist only on a chain that has called
 * `.id(...)` first (decision 4) — `PipelineChain` does not declare them at
 * all, so a maps-only pipeline is never offered them and a fold before `.id`
 * does not compile.
 *
 * The pipeline takes no dependencies. A handler that needs a collaborator is
 * constructed with one at the mount, the same way a store is (decision 6).
 */
export function definePipeline<const Name extends string = string>(
  name: Name,
): PipelineNamed<Name> {
  assertNoSeparators(name, "pipeline name", { name });
  return namedStage<Name>({
    name,
    prefix: undefined,
    events: {},
    id: undefined,
    commands: new Map(),
    folds: new Map(),
    maps: new Map(),
    processManagers: new Map(),
    subscribers: new Map(),
    mounts: [],
  });
}

// ---------------------------------------------------------------------------
// chain stages
// ---------------------------------------------------------------------------

export interface PipelineNamed<Name extends string> {
  prefix<const Prefix extends string>(prefix: Prefix): PipelineNamedPrefixed<Name, Prefix>;
  events<const Events extends EventSchemaMap>(
    events: Events,
  ): PipelineChain<Name, undefined, Events>;
}

export interface PipelineNamedPrefixed<Name extends string, Prefix extends string> {
  events<const Events extends EventSchemaMap>(
    events: Events,
  ): PipelineChain<Name, Prefix, Events>;
}

/**
 * The outer chain earns currying — each step's type depends on the one
 * before it, and `.id()` decides whether `.withFold` / `.withProcessManager`
 * exist at all. A mount is different: nothing inside it is gated, so every
 * `.withX` below takes a plain record rather than a builder callback.
 */
export interface PipelineChain<
  Name extends string,
  Prefix extends string | undefined,
  Events extends EventSchemaMap,
> {
  id(idMap: IdMap<Events>): PipelineChainWithId<Name, Prefix, Events>;

  withCommand<Input extends z.ZodTypeAny>(
    name: string,
    record: CommandBuilt<Events, Input>,
  ): PipelineChain<Name, Prefix, Events>;

  withMap<Handle extends MapHandlerMap<Events, unknown>>(
    name: string,
    record: MapWithStore<Events, Handle>,
  ): PipelineChain<Name, Prefix, Events>;

  /**
   * A map that arrives already built (ADR-107 decision 17): an enterprise
   * member, which cannot be imported unconditionally into an OSS pipeline
   * file and so crosses as a value the composition root builds and injects
   * behind an `if`; or a member whose source vocabulary belongs to another
   * pipeline entirely, which the declared form cannot express because its
   * `on` can only key on *this* chain's own `.events()`. `map.eventTypes` are
   * already-persisted type strings, supplied by the caller. `mount` is
   * supplied alongside it, rather than derived from a typed `store`, because
   * a pre-built map's store is already erased into `apply` — mount legality
   * (decision 14) is still checked, over the shape the caller states.
   */
  withMap(name: string, map: BuiltMap, mount: Mount): PipelineChain<Name, Prefix, Events>;

  withSubscriber(
    name: string,
    record: SubscriberOn<Events>,
  ): PipelineChain<Name, Prefix, Events>;

  /** The `.withSubscriber` counterpart to the pre-built `.withMap` above. */
  withSubscriber(
    name: string,
    subscriber: BuiltSubscriber,
  ): PipelineChain<Name, Prefix, Events>;

  build(ports?: PipelinePorts): BuiltPipeline<Name, Prefix>;
}

export interface PipelineChainWithId<
  Name extends string,
  Prefix extends string | undefined,
  Events extends EventSchemaMap,
> extends PipelineChain<Name, Prefix, Events> {
  withCommand<Input extends z.ZodTypeAny>(
    name: string,
    record: CommandBuilt<Events, Input>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withFold<StateSchema extends z.ZodTypeAny>(
    name: string,
    record: FoldWithStore<Events, StateSchema>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withMap<Handle extends MapHandlerMap<Events, unknown>>(
    name: string,
    record: MapWithStore<Events, Handle>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withMap(name: string, map: BuiltMap, mount: Mount): PipelineChainWithId<Name, Prefix, Events>;

  withProcessManager<StateSchema extends z.ZodTypeAny, Intents extends IntentMap>(
    name: string,
    record: ProcessManagerOn<Events, StateSchema, Intents>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withSubscriber(
    name: string,
    record: SubscriberOn<Events>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withSubscriber(
    name: string,
    subscriber: BuiltSubscriber,
  ): PipelineChainWithId<Name, Prefix, Events>;
}

// ---------------------------------------------------------------------------
// the five mount records
// ---------------------------------------------------------------------------

/** A command: what its input decodes to, and how it turns that input into the
 * events it emits. */
export interface CommandBuilt<Events extends EventSchemaMap, Input extends z.ZodTypeAny> {
  readonly input: Input;
  readonly handle: (
    input: z.infer<Input>,
    ctx: HandlerContext,
  ) => Promise<readonly EmittedEvent<Events>[]>;
}

/** A fold: its state schema, how it initialises and evolves, and the store it
 * reads back before every apply. `state` fixes `StateSchema`; `init`, `on` and
 * `store` are contextually typed from it. */
export interface FoldWithStore<Events extends EventSchemaMap, StateSchema extends z.ZodTypeAny> {
  readonly state: StateSchema;
  readonly init: () => z.output<StateSchema>;
  readonly pin?: string;
  readonly on: FoldHandlerMap<Events, NoInfer<z.output<StateSchema>>>;
  readonly store: ReplaceStore<NoInfer<z.output<StateSchema>>>;
}

/** A map: its handlers and the store they write to. `on` fixes `Handle`, and
 * `MappedRow<Handle>` — the row type `store` must accept — is recovered from
 * its handlers' own return types rather than declared a second time. */
export interface MapWithStore<
  Events extends EventSchemaMap,
  Handle extends MapHandlerMap<Events, unknown>,
> {
  readonly on: Handle;
  readonly store:
    | AppendStore<NoInfer<MappedRow<Handle>>>
    | MergeStore<NoInfer<MappedRow<Handle>>>;
}

/** A process manager: its state, its intents, its event handlers, and
 * optionally how it wakes itself and whether it runs at all. `onWake` and
 * `enabled` are ordinary optional fields — they exist on every declaration,
 * present or not, rather than extra chain steps that only sometimes appear. */
export interface ProcessManagerOn<
  Events extends EventSchemaMap,
  StateSchema extends z.ZodTypeAny,
  Intents extends IntentMap,
> {
  readonly state: StateSchema;
  readonly init: () => NoInfer<z.output<StateSchema>>;
  readonly pin?: string;
  readonly intents: Intents;
  readonly on: ProcessManagerHandlerMap<
    Events,
    NoInfer<z.output<StateSchema>>,
    NoInfer<Intents>
  >;
  readonly onWake?: (
    state: NoInfer<z.output<StateSchema>>,
    ctx: ProcessContext,
  ) => EvolveStep<NoInfer<z.output<StateSchema>>, NoInfer<Intents>>;
  readonly enabled?: boolean;
}

/** A subscriber: at-most-once work keyed by event, nothing else. */
export interface SubscriberOn<Events extends EventSchemaMap> {
  readonly on: SubscriberHandlerMap<Events>;
}

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

/** Deferred so the metrics port reaches the executor: mounting runs before
 * `.build()`, before the metrics `.build(ports)` supplies is known. */
type FoldFactory = (metrics: Metrics | undefined) => BuiltFold;
type MapFactory = (metrics: Metrics | undefined) => BuiltMap;

/**
 * Members are bound at mount, while their own types are still in scope, and
 * only the finished member is kept. Nothing generic is ever stored, so nothing
 * has to be erased to store it — which is what keeps this file free of casts.
 */
interface ChainState {
  name: string;
  prefix: string | undefined;
  events: EventSchemaMap;
  id: Readonly<Record<string, (data: never) => string>> | undefined;
  commands: Map<string, BuiltCommand<EventSchemaMap, z.ZodTypeAny>>;
  folds: Map<string, FoldFactory>;
  maps: Map<string, MapFactory>;
  processManagers: Map<string, BuiltProcessManager>;
  subscribers: Map<string, BuiltSubscriber>;
  mounts: { readonly member: string; readonly mount: Mount }[];
}

function typeOfEventIn(state: ChainState): (key: string) => string {
  return (key) => eventTypeOf({ prefix: state.prefix, name: state.name, key });
}

function declareEvents(state: ChainState, events: EventSchemaMap): void {
  const keys = Object.keys(events);
  if (keys.length === 0) {
    throw new ConfigurationError(`pipeline "${state.name}" declares no events`, {
      pipeline: state.name,
    });
  }
  for (const key of keys) {
    assertKeyIsSafe(key, "event key", { pipeline: state.name, key });
  }
  state.events = events;
}

function assertNameNotTaken(state: ChainState, name: string): void {
  const taken =
    state.commands.has(name) ||
    state.folds.has(name) ||
    state.maps.has(name) ||
    state.processManagers.has(name) ||
    state.subscribers.has(name);
  if (taken) {
    throw new ConfigurationError(
      `pipeline "${state.name}" already mounts something named "${name}"`,
      { pipeline: state.name, name },
    );
  }
}

// ---- mount checking (ADR-106) ----

/** A fold's lane is always `{aggregateType, aggregateId}`: `.withFold` exists
 * only after `.id()`, and `.id()` is that lane (ADR-105 decision 4). */
const FOLD_SCOPE: ScopeKind = "aggregate";

/** Placeholder only: this chain has no `.scope()`/`.collapse()`, so a map's
 * scope and every mount's collapse are dispatch-plane facts (ADR-100) it
 * cannot see. Safe because the `*_DECIDABLE_RULES` sets below exclude every
 * rule that would depend on them. */
const UNDECLARED_SCOPE: ScopeKind = "aggregate";
const UNDECLARED_COLLAPSE: CollapseKind = "none";

/** Already guaranteed by construction (`FOLD_SCOPE`, and `FoldWithStore`'s
 * `ReplaceStore`-only field); checked anyway as a backstop. */
const FOLD_DECIDABLE_RULES: ReadonlySet<string> = new Set([
  "fold-scope-must-be-aggregate",
  "fold-store-must-be-replace",
]);

/** Depend only on `store` and `idempotency`, both read off the mounted store. */
const MAP_DECIDABLE_RULES: ReadonlySet<string> = new Set([
  "merge-closed-to-new-adopters",
  "merge-requires-idempotency",
]);

/** Runs ADR-106's checker over every mount, reporting every violation this
 * chain can decide in one pass rather than one per rebuild. */
function assertMountsAreLegal(state: ChainState): void {
  const violations = state.mounts.flatMap(({ member, mount }) => {
    const decidable = mount.projection === "fold" ? FOLD_DECIDABLE_RULES : MAP_DECIDABLE_RULES;
    return validateMount(mount)
      .filter((violation) => decidable.has(violation.rule))
      .map((violation) => ({ member, rule: violation.rule, message: violation.message }));
  });
  if (violations.length === 0) return;
  throw new ConfigurationError(
    `pipeline "${state.name}" mounts an illegal projection: ` +
      violations
        .map((v) => `"${v.member}" breaks "${v.rule}" (${v.message})`)
        .join("; "),
    { pipeline: state.name, violations },
  );
}

// ---- stages ----

function namedStage<Name extends string>(state: ChainState): PipelineNamed<Name> {
  return {
    prefix<const Prefix extends string>(prefix: Prefix) {
      assertPrefixIsSafe(prefix, "pipeline prefix", { prefix });
      state.prefix = prefix;
      return prefixedStage<Name, Prefix>(state);
    },
    events<const Events extends EventSchemaMap>(events: Events) {
      declareEvents(state, events);
      return chainStage<Name, undefined, Events>(state);
    },
  };
}

function prefixedStage<Name extends string, Prefix extends string>(
  state: ChainState,
): PipelineNamedPrefixed<Name, Prefix> {
  return {
    events<const Events extends EventSchemaMap>(events: Events) {
      declareEvents(state, events);
      return chainStage<Name, Prefix, Events>(state);
    },
  };
}

function chainStage<
  Name extends string,
  Prefix extends string | undefined,
  Events extends EventSchemaMap,
>(state: ChainState): PipelineChain<Name, Prefix, Events> {
  const chain: PipelineChain<Name, Prefix, Events> = {
    id(idMap) {
      state.id = idMap;
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withCommand(name, record) {
      mountCommand(state, name, record);
      return chainStage<Name, Prefix, Events>(state);
    },
    withMap(
      name: string,
      record: MapWithStore<Events, MapHandlerMap<Events, unknown>> | BuiltMap,
      mount?: Mount,
    ) {
      mountMap(state, name, record, mount);
      return chainStage<Name, Prefix, Events>(state);
    },
    withSubscriber(name, record) {
      mountSubscriber(state, name, record);
      return chainStage<Name, Prefix, Events>(state);
    },
    build(ports) {
      return assemble<Name, Prefix>(state, ports);
    },
  };
  return attachIdGuards(chain, state);
}

/**
 * `withFold` and `withProcessManager` are absent from `PipelineChain`, so no
 * typed caller is offered them before `.id()`. They are attached anyway, so a
 * caller arriving through an erased type gets the reason rather than "x is not
 * a function".
 */
function attachIdGuards<Chain extends object>(chain: Chain, state: ChainState): Chain {
  const refuse = (what: string) => (): never => {
    throw new ConfigurationError(
      `pipeline "${state.name}" mounts a ${what} before declaring .id()`,
      { pipeline: state.name, what },
    );
  };
  return Object.defineProperties(chain, {
    withFold: { value: refuse("fold") },
    withProcessManager: { value: refuse("process manager") },
  });
}

function chainWithIdStage<
  Name extends string,
  Prefix extends string | undefined,
  Events extends EventSchemaMap,
>(state: ChainState): PipelineChainWithId<Name, Prefix, Events> {
  return {
    id(idMap) {
      state.id = idMap;
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withCommand(name, record) {
      mountCommand(state, name, record);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withFold(name, record) {
      mountFold(state, name, record);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withMap(
      name: string,
      record: MapWithStore<Events, MapHandlerMap<Events, unknown>> | BuiltMap,
      mount?: Mount,
    ) {
      mountMap(state, name, record, mount);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withProcessManager(name, record) {
      mountProcessManager(state, name, record);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withSubscriber(name, record) {
      mountSubscriber(state, name, record);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    build(ports) {
      return assemble<Name, Prefix>(state, ports);
    },
  };
}

// ---- mounts ----

function mountCommand<Events extends EventSchemaMap, Input extends z.ZodTypeAny>(
  state: ChainState,
  name: string,
  record: CommandBuilt<Events, Input>,
): void {
  assertNameNotTaken(state, name);
  const typeOf = typeOfEventIn(state);
  state.commands.set(name, {
    name,
    input: record.input,
    async handle(input, ctx) {
      const emitted = await record.handle(input, ctx);
      return emitted.map((event) => ({ type: typeOf(event.type), data: event.data }));
    },
  });
}

function mountFold<Events extends EventSchemaMap, StateSchema extends z.ZodTypeAny>(
  state: ChainState,
  name: string,
  record: FoldWithStore<Events, StateSchema>,
): void {
  assertNameNotTaken(state, name);
  const dispatch = resolveDispatch({
    handlers: record.on,
    typeOf: typeOfEventIn(state),
    what: "fold",
    owner: name,
  });
  const { version, schemaHash } = resolveStateVersion({
    schema: record.state,
    pinned: record.pin,
  });
  state.mounts.push({
    member: name,
    mount: {
      projection: "fold",
      store: record.store.kind,
      scope: FOLD_SCOPE,
      collapse: UNDECLARED_COLLAPSE,
      idempotency: undefined,
    },
  });
  state.folds.set(name, (metrics) => {
    const executor = createFoldExecutor<z.output<StateSchema>, WireEvent>({
      store: record.store,
      init: record.init,
      apply(foldState, event) {
        const handler = wireHandler<[z.output<StateSchema>, unknown], z.output<StateSchema>>(
          dispatch,
          event.type,
        );
        return handler ? handler(foldState, event.data) : foldState;
      },
      stateVersion: version,
      projectionName: name,
      metrics,
    });
    return {
      name,
      eventTypes: [...dispatch.keys()],
      stateVersion: version,
      schemaHash,
      apply: executor.apply,
    };
  });
}

function mountMap<Events extends EventSchemaMap, Handle extends MapHandlerMap<Events, unknown>>(
  state: ChainState,
  name: string,
  record: MapWithStore<Events, Handle> | BuiltMap,
  mount?: Mount,
): void {
  assertNameNotTaken(state, name);
  // A pre-built map (ADR-107 decision 17) arrives with its own `Mount`
  // already stated by the caller, since its store is erased into `apply`.
  if (mount !== undefined) {
    const built = record as BuiltMap;
    state.mounts.push({ member: name, mount });
    state.maps.set(name, () => built);
    return;
  }
  const declared = record as MapWithStore<Events, Handle>;
  const dispatch = resolveDispatch({
    handlers: declared.on,
    typeOf: typeOfEventIn(state),
    what: "map",
    owner: name,
  });
  state.mounts.push({
    member: name,
    mount:
      declared.store.kind === "merge"
        ? {
            projection: "map",
            store: "merge",
            scope: UNDECLARED_SCOPE,
            collapse: UNDECLARED_COLLAPSE,
            idempotency: declared.store.idempotency,
          }
        : {
            projection: "map",
            store: declared.store.kind,
            scope: UNDECLARED_SCOPE,
            collapse: UNDECLARED_COLLAPSE,
            idempotency: undefined,
          },
  });
  state.maps.set(name, (metrics) => {
    const executor = createMapExecutor<WireEvent, MappedRow<Handle>>({
      store: declared.store,
      map(event) {
        const handler = wireHandler<
          [unknown],
          MappedRow<Handle> | readonly MappedRow<Handle>[] | null
        >(dispatch, event.type);
        return handler ? handler(event.data) : null;
      },
      projectionName: name,
      metrics,
    });
    return {
      name,
      eventTypes: [...dispatch.keys()],
      apply: executor.apply,
    };
  });
}

function mountProcessManager<
  Events extends EventSchemaMap,
  StateSchema extends z.ZodTypeAny,
  Intents extends IntentMap,
>(state: ChainState, name: string, record: ProcessManagerOn<Events, StateSchema, Intents>): void {
  if (state.id === undefined) {
    throw new ConfigurationError(
      `pipeline "${state.name}" mounts a process manager before declaring .id()`,
      { pipeline: state.name, name },
    );
  }
  assertNameNotTaken(state, name);

  const intentKeys = Object.keys(record.intents);
  if (intentKeys.length === 0) {
    throw new ConfigurationError(`process manager "${name}" declares no intents`, {
      processManager: name,
    });
  }
  for (const key of intentKeys) {
    assertNoSeparators(key, "intent key", { processManager: name, key });
  }

  const dispatch = resolveDispatch({
    handlers: record.on,
    typeOf: typeOfEventIn(state),
    what: "process manager",
    owner: name,
  });
  const { version, schemaHash } = resolveStateVersion({
    schema: record.state,
    pinned: record.pin,
  });

  const intentTypeFor = (key: string): string => intentTypeOf(name, key);
  const intents: Record<string, BuiltProcessManagerIntent> = {};
  for (const [key, intent] of Object.entries(record.intents)) {
    intents[key] = {
      payload: intent.payload,
      messageKey: (payload) => intent.messageKey(payload),
      deliver: (payload, ctx) => intent.deliver(payload, ctx),
    };
  }
  const toIntentRows = (emitted: readonly { type: string; payload: unknown }[]) =>
    emitted.map((intent) => ({ type: intentTypeFor(intent.type), payload: intent.payload }));

  const { onWake: onWakeFn } = record;
  state.processManagers.set(name, {
    name,
    enabled: record.enabled ?? true,
    eventTypes: [...dispatch.keys()],
    intentTypes: intentKeys.map(intentTypeFor),
    stateSchema: record.state,
    stateVersion: version,
    schemaHash,
    intents,
    init: record.init,
    evolve(evolveState, event, ctx) {
      const handler = wireHandler<
        [unknown, unknown, ProcessContext],
        EvolveStep<z.output<StateSchema>, Intents>
      >(dispatch, event.type);
      if (!handler) return null;
      const step = handler(evolveState, event.data, ctx);
      return { ...step, intents: toIntentRows(step.intents) };
    },
    onWake: onWakeFn
      ? (wakeState, ctx) => {
          // Same seam as `wireHandler`: the runtime loaded this state as
          // `unknown`, and the declaration is what says its shape.
          const step = onWakeFn(wakeState as z.output<StateSchema>, ctx);
          return { ...step, intents: toIntentRows(step.intents) };
        }
      : undefined,
  });
}

function mountSubscriber<Events extends EventSchemaMap>(
  state: ChainState,
  name: string,
  record: SubscriberOn<Events> | BuiltSubscriber,
): void {
  assertNameNotTaken(state, name);
  // A pre-built subscriber (ADR-107 decision 17) has no `on` at all — it
  // arrives as a plain `BuiltSubscriber`, dispatch already resolved by
  // whoever constructed it.
  if (!("on" in record)) {
    state.subscribers.set(name, record);
    return;
  }
  const dispatch = resolveDispatch({
    handlers: record.on,
    typeOf: typeOfEventIn(state),
    what: "subscriber",
    owner: name,
  });
  state.subscribers.set(name, {
    name,
    eventTypes: [...dispatch.keys()],
    handle(event, ctx) {
      const handler = wireHandler<[unknown, HandlerContext], void | Promise<void>>(
        dispatch,
        event.type,
      );
      return handler ? handler(event.data, ctx) : undefined;
    },
  });
}

/** Binds each declared `.id()` extractor to its own event's persisted type
 * string, once, so `aggregateIdFor` is a map lookup rather than a re-walk of
 * the id map per call (ADR-107 decision 4). */
function buildIdExtractors(state: ChainState): Map<string, (data: unknown) => string> {
  const typeOf = typeOfEventIn(state);
  const extractors = new Map<string, (data: unknown) => string>();
  for (const [key, extractor] of Object.entries(state.id ?? {})) {
    extractors.set(typeOf(key), extractor as unknown as (data: unknown) => string);
  }
  return extractors;
}

function assemble<Name extends string, Prefix extends string | undefined>(
  state: ChainState,
  ports: PipelinePorts | undefined,
): BuiltPipeline<Name, Prefix> {
  assertMountsAreLegal(state);
  const metrics = ports?.metrics;
  const idExtractors = buildIdExtractors(state);
  return {
    name: state.name as Name,
    prefix: state.prefix as Prefix,
    eventTypes: Object.keys(state.events).map(typeOfEventIn(state)),
    commands: Object.fromEntries(state.commands),
    folds: Object.fromEntries(
      [...state.folds].map(([memberName, factory]) => [memberName, factory(metrics)]),
    ),
    maps: Object.fromEntries(
      [...state.maps].map(([memberName, factory]) => [memberName, factory(metrics)]),
    ),
    processManagers: Object.fromEntries(state.processManagers),
    subscribers: Object.fromEntries(state.subscribers),
    aggregateIdFor(eventType, payload) {
      const extractor = idExtractors.get(eventType);
      if (!extractor) {
        throw new ConfigurationError(
          `pipeline "${state.name}" has no id extractor for event type "${eventType}"`,
          { pipeline: state.name, eventType },
        );
      }
      return extractor(payload);
    },
  };
}
