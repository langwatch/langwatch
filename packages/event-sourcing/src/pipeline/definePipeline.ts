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

export interface PipelineChain<
  Name extends string,
  Prefix extends string | undefined,
  Events extends EventSchemaMap,
> {
  id(idMap: IdMap<Events>): PipelineChainWithId<Name, Prefix, Events>;

  withCommand<Input extends z.ZodTypeAny>(
    name: string,
    builder: (c: CommandStart<Events>) => CommandBuilt<Events, Input>,
  ): PipelineChain<Name, Prefix, Events>;

  withMap<Handle extends MapHandlerMap<Events, unknown>>(
    name: string,
    builder: (m: MapStart<Events>) => MapWithStore<Events, MappedRow<Handle>>,
  ): PipelineChain<Name, Prefix, Events>;

  withSubscriber(
    name: string,
    builder: (s: SubscriberStart<Events>) => SubscriberOn<Events>,
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
    builder: (c: CommandStart<Events>) => CommandBuilt<Events, Input>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withFold<State>(
    name: string,
    builder: (f: FoldStart<Events>) => FoldWithStore<Events, State>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withMap<Handle extends MapHandlerMap<Events, unknown>>(
    name: string,
    builder: (m: MapStart<Events>) => MapWithStore<Events, MappedRow<Handle>>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withProcessManager<State, Intents extends IntentMap>(
    name: string,
    builder: (pm: ProcessManagerStart<Events>) => ProcessManagerOn<Events, State, Intents>,
  ): PipelineChainWithId<Name, Prefix, Events>;

  withSubscriber(
    name: string,
    builder: (s: SubscriberStart<Events>) => SubscriberOn<Events>,
  ): PipelineChainWithId<Name, Prefix, Events>;
}

// ---- command ----

export interface CommandStart<Events extends EventSchemaMap> {
  input<Input extends z.ZodTypeAny>(schema: Input): CommandWithInput<Events, Input>;
}

export interface CommandWithInput<Events extends EventSchemaMap, Input extends z.ZodTypeAny> {
  handle(
    fn: (
      input: z.infer<Input>,
      ctx: HandlerContext,
    ) => Promise<readonly EmittedEvent<Events>[]>,
  ): CommandBuilt<Events, Input>;
}

export interface CommandBuilt<Events extends EventSchemaMap, Input extends z.ZodTypeAny> {
  readonly input: Input;
  readonly handle: (
    input: z.infer<Input>,
    ctx: HandlerContext,
  ) => Promise<readonly EmittedEvent<Events>[]>;
}

// ---- fold ----

export interface FoldStart<Events extends EventSchemaMap> {
  state<StateSchema extends z.ZodTypeAny>(
    schema: StateSchema,
    init: () => z.output<StateSchema>,
    pin?: string,
  ): FoldStated<Events, z.output<StateSchema>>;
}

export interface FoldStated<Events extends EventSchemaMap, State> {
  on(handlers: FoldHandlerMap<Events, State>): FoldOn<Events, State>;
}

export interface FoldOn<Events extends EventSchemaMap, State> {
  store(store: ReplaceStore<State>): FoldWithStore<Events, State>;
}

export interface FoldWithStore<Events extends EventSchemaMap, State> {
  readonly stateSchema: z.ZodTypeAny;
  readonly init: () => State;
  readonly pin: string | undefined;
  readonly on: FoldHandlerMap<Events, State>;
  readonly store: ReplaceStore<State>;
}

// ---- map ----

export interface MapStart<Events extends EventSchemaMap> {
  on<Handle extends MapHandlerMap<Events, unknown>>(
    handlers: Handle,
  ): MapOn<Events, MappedRow<Handle>>;
}

export interface MapOn<Events extends EventSchemaMap, Row> {
  store(store: AppendStore<Row> | MergeStore<Row>): MapWithStore<Events, Row>;
}

export interface MapWithStore<Events extends EventSchemaMap, Row> {
  /** Loose in the row type on purpose: `Row` is recovered from these handlers'
   * own return types, so re-deriving it here would be circular. */
  readonly on: MapHandlerMap<Events, unknown>;
  readonly store: AppendStore<Row> | MergeStore<Row>;
}

// ---- process manager ----

export interface ProcessManagerStart<Events extends EventSchemaMap> {
  state<StateSchema extends z.ZodTypeAny>(
    schema: StateSchema,
    init: () => z.output<StateSchema>,
    pin?: string,
  ): ProcessManagerStated<Events, z.output<StateSchema>>;
}

export interface ProcessManagerStated<Events extends EventSchemaMap, State> {
  intents<Intents extends IntentMap>(
    intents: Intents,
  ): ProcessManagerIntented<Events, State, Intents>;
}

export interface ProcessManagerIntented<
  Events extends EventSchemaMap,
  State,
  Intents extends IntentMap,
> {
  on(
    handlers: ProcessManagerHandlerMap<Events, State, Intents>,
  ): ProcessManagerOn<Events, State, Intents>;
}

export interface ProcessManagerOn<
  Events extends EventSchemaMap,
  State,
  Intents extends IntentMap,
> {
  readonly stateSchema: z.ZodTypeAny;
  readonly init: () => State;
  readonly pin: string | undefined;
  readonly intents: Intents;
  readonly on: ProcessManagerHandlerMap<Events, State, Intents>;
  readonly onWakeFn:
    | ((state: State, ctx: ProcessContext) => EvolveStep<State, Intents>)
    | undefined;
  readonly isEnabled: boolean;
  onWake(
    fn: (state: State, ctx: ProcessContext) => EvolveStep<State, Intents>,
  ): ProcessManagerOn<Events, State, Intents>;
  enabled(flag: boolean): ProcessManagerOn<Events, State, Intents>;
}

// ---- subscriber ----

export interface SubscriberStart<Events extends EventSchemaMap> {
  on(handlers: SubscriberHandlerMap<Events>): SubscriberOn<Events>;
}

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

/** Already guaranteed by construction (`FOLD_SCOPE`, and `FoldOn.store`'s
 * `ReplaceStore`-only signature); checked anyway as a backstop. */
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
    withCommand(name, builder) {
      mountCommand(state, name, builder);
      return chainStage<Name, Prefix, Events>(state);
    },
    withMap(name, builder) {
      mountMap(state, name, builder);
      return chainStage<Name, Prefix, Events>(state);
    },
    withSubscriber(name, builder) {
      mountSubscriber(state, name, builder);
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
    withCommand(name, builder) {
      mountCommand(state, name, builder);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withFold(name, builder) {
      mountFold(state, name, builder);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withMap(name, builder) {
      mountMap(state, name, builder);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withProcessManager(name, builder) {
      mountProcessManager(state, name, builder);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    withSubscriber(name, builder) {
      mountSubscriber(state, name, builder);
      return chainWithIdStage<Name, Prefix, Events>(state);
    },
    build(ports) {
      return assemble<Name, Prefix>(state, ports);
    },
  };
}

// ---- mounts ----

function commandStart<Events extends EventSchemaMap>(): CommandStart<Events> {
  return {
    input<Input extends z.ZodTypeAny>(schema: Input) {
      return {
        handle(fn) {
          return { input: schema, handle: fn };
        },
      };
    },
  };
}

function mountCommand<Events extends EventSchemaMap, Input extends z.ZodTypeAny>(
  state: ChainState,
  name: string,
  builder: (c: CommandStart<Events>) => CommandBuilt<Events, Input>,
): void {
  assertNameNotTaken(state, name);
  const built = builder(commandStart<Events>());
  const typeOf = typeOfEventIn(state);
  state.commands.set(name, {
    name,
    input: built.input,
    async handle(input, ctx) {
      const emitted = await built.handle(input, ctx);
      return emitted.map((event) => ({ type: typeOf(event.type), data: event.data }));
    },
  });
}

function foldStart<Events extends EventSchemaMap>(): FoldStart<Events> {
  return {
    state(schema, init, pin) {
      return {
        on(handlers) {
          return {
            store(store) {
              return { stateSchema: schema, init, pin, on: handlers, store };
            },
          };
        },
      };
    },
  };
}

function mountFold<Events extends EventSchemaMap, State>(
  state: ChainState,
  name: string,
  builder: (f: FoldStart<Events>) => FoldWithStore<Events, State>,
): void {
  assertNameNotTaken(state, name);
  const built = builder(foldStart<Events>());
  const dispatch = resolveDispatch({
    handlers: built.on,
    typeOf: typeOfEventIn(state),
    what: "fold",
    owner: name,
  });
  const { version, schemaHash } = resolveStateVersion({
    schema: built.stateSchema,
    pinned: built.pin,
  });
  state.mounts.push({
    member: name,
    mount: {
      projection: "fold",
      store: built.store.kind,
      scope: FOLD_SCOPE,
      collapse: UNDECLARED_COLLAPSE,
      idempotency: undefined,
    },
  });
  state.folds.set(name, (metrics) => {
    const executor = createFoldExecutor<State, WireEvent>({
      store: built.store,
      init: built.init,
      apply(foldState, event) {
        const handler = wireHandler<[State, unknown], State>(dispatch, event.type);
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

function mapStart<Events extends EventSchemaMap>(): MapStart<Events> {
  return {
    on(handlers) {
      return {
        store(store) {
          return { on: handlers, store };
        },
      };
    },
  };
}

function mountMap<Events extends EventSchemaMap, Row>(
  state: ChainState,
  name: string,
  builder: (m: MapStart<Events>) => MapWithStore<Events, Row>,
): void {
  assertNameNotTaken(state, name);
  const built = builder(mapStart<Events>());
  const dispatch = resolveDispatch({
    handlers: built.on,
    typeOf: typeOfEventIn(state),
    what: "map",
    owner: name,
  });
  state.mounts.push({
    member: name,
    mount:
      built.store.kind === "merge"
        ? {
            projection: "map",
            store: "merge",
            scope: UNDECLARED_SCOPE,
            collapse: UNDECLARED_COLLAPSE,
            idempotency: built.store.idempotency,
          }
        : {
            projection: "map",
            store: built.store.kind,
            scope: UNDECLARED_SCOPE,
            collapse: UNDECLARED_COLLAPSE,
            idempotency: undefined,
          },
  });
  state.maps.set(name, (metrics) => {
    const executor = createMapExecutor<WireEvent, Row>({
      store: built.store,
      map(event) {
        const handler = wireHandler<[unknown], Row | readonly Row[] | null>(
          dispatch,
          event.type,
        );
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

function processManagerStart<Events extends EventSchemaMap>(
  owner: string,
): ProcessManagerStart<Events> {
  return {
    state(schema, init, pin) {
      return {
        intents(intents) {
          const keys = Object.keys(intents);
          if (keys.length === 0) {
            throw new ConfigurationError(
              `process manager "${owner}" declares no intents`,
              { processManager: owner },
            );
          }
          for (const key of keys) {
            assertNoSeparators(key, "intent key", { processManager: owner, key });
          }
          return {
            on(handlers) {
              return processManagerOn({
                stateSchema: schema,
                init,
                pin,
                intents,
                on: handlers,
                onWakeFn: undefined,
                isEnabled: true,
              });
            },
          };
        },
      };
    },
  };
}

/** `.onWake()` and `.enabled()` return a fresh declaration rather than mutating
 * one, so a builder callback cannot change a mount it has already returned. */
function processManagerOn<Events extends EventSchemaMap, State, Intents extends IntentMap>(
  fields: Omit<ProcessManagerOn<Events, State, Intents>, "onWake" | "enabled">,
): ProcessManagerOn<Events, State, Intents> {
  return {
    ...fields,
    onWake(fn) {
      return processManagerOn<Events, State, Intents>({ ...fields, onWakeFn: fn });
    },
    enabled(flag) {
      return processManagerOn<Events, State, Intents>({ ...fields, isEnabled: flag });
    },
  };
}

function mountProcessManager<Events extends EventSchemaMap, State, Intents extends IntentMap>(
  state: ChainState,
  name: string,
  builder: (pm: ProcessManagerStart<Events>) => ProcessManagerOn<Events, State, Intents>,
): void {
  if (state.id === undefined) {
    throw new ConfigurationError(
      `pipeline "${state.name}" mounts a process manager before declaring .id()`,
      { pipeline: state.name, name },
    );
  }
  assertNameNotTaken(state, name);
  const built = builder(processManagerStart<Events>(name));
  const dispatch = resolveDispatch({
    handlers: built.on,
    typeOf: typeOfEventIn(state),
    what: "process manager",
    owner: name,
  });
  const { version, schemaHash } = resolveStateVersion({
    schema: built.stateSchema,
    pinned: built.pin,
  });

  const intentTypeFor = (key: string): string => intentTypeOf(name, key);
  const intents: Record<string, BuiltProcessManagerIntent> = {};
  for (const [key, intent] of Object.entries(built.intents)) {
    intents[key] = {
      payload: intent.payload,
      messageKey: (payload) => intent.messageKey(payload),
      deliver: (payload, ctx) => intent.deliver(payload, ctx),
    };
  }
  const toIntentRows = (emitted: readonly { type: string; payload: unknown }[]) =>
    emitted.map((intent) => ({ type: intentTypeFor(intent.type), payload: intent.payload }));

  const { onWakeFn } = built;
  state.processManagers.set(name, {
    name,
    enabled: built.isEnabled,
    eventTypes: [...dispatch.keys()],
    intentTypes: Object.keys(built.intents).map(intentTypeFor),
    stateSchema: built.stateSchema,
    stateVersion: version,
    schemaHash,
    intents,
    init: built.init,
    evolve(evolveState, event, ctx) {
      const handler = wireHandler<
        [unknown, unknown, ProcessContext],
        EvolveStep<State, Intents>
      >(dispatch, event.type);
      if (!handler) return null;
      const step = handler(evolveState, event.data, ctx);
      return { ...step, intents: toIntentRows(step.intents) };
    },
    onWake: onWakeFn
      ? (wakeState, ctx) => {
          // Same seam as `wireHandler`: the runtime loaded this state as
          // `unknown`, and the declaration is what says its shape.
          const step = onWakeFn(wakeState as State, ctx);
          return { ...step, intents: toIntentRows(step.intents) };
        }
      : undefined,
  });
}

function subscriberStart<Events extends EventSchemaMap>(): SubscriberStart<Events> {
  return {
    on(handlers) {
      return { on: handlers };
    },
  };
}

function mountSubscriber<Events extends EventSchemaMap>(
  state: ChainState,
  name: string,
  builder: (s: SubscriberStart<Events>) => SubscriberOn<Events>,
): void {
  assertNameNotTaken(state, name);
  const built = builder(subscriberStart<Events>());
  const dispatch = resolveDispatch({
    handlers: built.on,
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

function assemble<Name extends string, Prefix extends string | undefined>(
  state: ChainState,
  ports: PipelinePorts | undefined,
): BuiltPipeline<Name, Prefix> {
  assertMountsAreLegal(state);
  const metrics = ports?.metrics;
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
  };
}
