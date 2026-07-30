import type { z } from "zod";
import type {
  AppendStore,
  MergeStore,
  ReplaceStore,
} from "../projections/store.types";
import type { EventTypeString, IntentTypeString } from "./typeStrings";

/**
 * The chain's shared vocabulary (ADR-105). An event is its payload schema —
 * nothing else is part of the declaration, and state belongs to whichever
 * member accumulates it, never to the vocabulary.
 */
export type EventSchemaMap = Record<string, z.ZodTypeAny>;

/** Every declared event's persisted type string, keyed by its own map key. */
export type EventTypeStrings<
  Name extends string,
  Events extends EventSchemaMap,
  Prefix extends string | undefined,
> = {
  readonly [K in keyof Events & string]: EventTypeString<Name, K, Prefix>;
};

/**
 * `.id` — exhaustive over `.events()`, so an event with no extractor does not
 * compile (ADR-105 decision 4). Each extractor is typed against its own
 * event's payload alone.
 */
export type IdMap<Events extends EventSchemaMap> = {
  readonly [K in keyof Events & string]: (data: z.infer<Events[K]>) => string;
};

/**
 * What a command or a process manager hands back to name a new event: its own
 * vocabulary key, never a persisted type string. `.build()` is the only place
 * a key becomes the string that is actually written.
 */
export type EmittedEvent<Events extends EventSchemaMap> = {
  [K in keyof Events & string]: {
    readonly type: K;
    readonly data: z.infer<Events[K]>;
  };
}[keyof Events & string];

/** An event as it arrives off the wire: a persisted type string and a payload
 * not yet narrowed to any one event's shape. */
export interface WireEvent {
  readonly type: string;
  readonly data: unknown;
}

/** One typed handler per subscribed event, for a fold (ADR-105 decision 5:
 * exhaustiveness is not required — an unhandled event is a no-op). */
export type FoldHandlerMap<Events extends EventSchemaMap, State> = {
  readonly [K in keyof Events & string]?: (
    state: State,
    data: z.infer<Events[K]>,
  ) => State;
};

/** One typed handler per subscribed event, for a map. */
export type MapHandlerMap<Events extends EventSchemaMap, Row> = {
  readonly [K in keyof Events & string]?: (
    data: z.infer<Events[K]>,
  ) => Row | readonly Row[] | null;
};

/**
 * The record type a map's handlers produce, recovered from their return types
 * so a call site never annotates it. A handler may return one record, several,
 * or none, and all three collapse to the same record type here.
 */
export type MappedRow<Handle> = {
  [K in keyof Handle]: NonNullable<Handle[K]> extends (
    data: never,
  ) => infer Returned
    ? Returned extends readonly (infer Element)[]
      ? Element
      : Exclude<Returned, null>
    : never;
}[keyof Handle];

/**
 * The facts only the runtime knows. Collaborators do not travel here — a
 * handler that needs one is constructed with it at the mount (ADR-105
 * decision 6), so this stays the same shape for every pipeline.
 */
export interface HandlerContext {
  readonly now: number;
  readonly tenantId: string;
}

/** A process-manager step additionally knows which instance it is running for. */
export interface ProcessContext extends HandlerContext {
  readonly processKey: string;
}

/** One typed handler per subscribed event, for a subscriber — at-most-once
 * work that may be lost without consequence (ADR-098). */
export type SubscriberHandlerMap<Events extends EventSchemaMap> = {
  readonly [K in keyof Events & string]?: (
    data: z.infer<Events[K]>,
    ctx: HandlerContext,
  ) => void | Promise<void>;
};

/**
 * One intent: the shape of its payload, the natural key its dispatch dedupes
 * on, and how it is delivered — declared together (ADR-105 decision 8), so a
 * declared intent with no delivery does not compile and a delivery for an
 * intent nobody declared has nowhere to go.
 *
 * `messageKey`'s only input is the declared payload, which is what keeps a key
 * from being built off the clock or off state the payload never declared —
 * the two ways a redelivery of the same logical intent computes a different
 * key and both dispatch.
 */
export interface IntentDef<Payload extends z.ZodTypeAny> {
  readonly payload: Payload;
  readonly messageKey: (payload: z.infer<Payload>) => string;
  readonly deliver: (
    payload: z.infer<Payload>,
    ctx: HandlerContext,
  ) => void | Promise<void>;
}

export type IntentMap = Record<string, IntentDef<z.ZodTypeAny>>;

export type IntentTypeStrings<
  Name extends string,
  Intents extends IntentMap,
> = {
  readonly [K in keyof Intents & string]: IntentTypeString<Name, K>;
};

/** What a process-manager step hands back to name an intent: its own
 * vocabulary key, never the qualified `processManagerName/key` string. */
export type EmittedIntent<Intents extends IntentMap> = {
  [K in keyof Intents & string]: {
    readonly type: K;
    readonly payload: z.infer<Intents[K]["payload"]>;
  };
}[keyof Intents & string];

/**
 * The result of one process-manager step (ADR-098 decision 1). `nextWakeAt`
 * is required: `null` clears whatever deadline was armed, a number replaces
 * it, and "leave it as it was" is spelled by returning the same number back —
 * never by omitting the field.
 */
export interface EvolveStep<State, Intents extends IntentMap> {
  readonly state: State;
  readonly intents: readonly EmittedIntent<Intents>[];
  readonly nextWakeAt: number | null;
}

/** One typed handler per subscribed event, for a process manager. An event
 * with no declared handler runs no step at all: state, intents and the armed
 * wake are all left exactly as they were (ADR-105 decision 5). */
export type ProcessManagerHandlerMap<
  Events extends EventSchemaMap,
  State,
  Intents extends IntentMap,
> = {
  readonly [K in keyof Events & string]?: (
    state: State,
    data: z.infer<Events[K]>,
    ctx: ProcessContext,
  ) => EvolveStep<State, Intents>;
};

// ---- what `.build()` hands back per member ----

export interface BuiltCommand<
  Events extends EventSchemaMap,
  Input extends z.ZodTypeAny,
> {
  readonly name: string;
  readonly input: Input;
  handle(
    input: z.infer<Input>,
    ctx: HandlerContext,
  ): Promise<readonly { readonly type: string; readonly data: unknown }[]>;
}

export interface FoldDeliveryLike {
  readonly key: string;
  readonly tenantId: string;
  readonly events: readonly WireEvent[];
  readonly retentionDays?: number;
}

export interface BuiltFold {
  readonly name: string;
  readonly eventTypes: readonly string[];
  readonly stateVersion: string;
  readonly schemaHash: string;
  apply(delivery: FoldDeliveryLike): Promise<{ events: number }>;
}

export interface MapDeliveryLike {
  readonly tenantId: string;
  readonly events: readonly WireEvent[];
  readonly retentionDays?: number;
}

export interface BuiltMap {
  readonly name: string;
  readonly eventTypes: readonly string[];
  apply(delivery: MapDeliveryLike): Promise<{ written: number }>;
}

export interface BuiltProcessManagerIntent {
  readonly payload: z.ZodTypeAny;
  messageKey(payload: unknown): string;
  deliver(payload: unknown, ctx: HandlerContext): void | Promise<void>;
}

/** A process-manager step, type-erased the way every other `Record<string,
 * X>` member of a built pipeline is — dynamic lookup by name loses the
 * per-mount literal types, same as `BuiltCommand.handle`'s emitted events. */
export interface BuiltEvolveStep<State> {
  readonly state: State;
  readonly intents: readonly {
    readonly type: string;
    readonly payload: unknown;
  }[];
  readonly nextWakeAt: number | null;
}

export interface BuiltProcessManager<State = unknown> {
  readonly name: string;
  readonly enabled: boolean;
  readonly eventTypes: readonly string[];
  readonly intentTypes: readonly string[];
  readonly stateSchema: z.ZodType<State>;
  readonly stateVersion: string;
  readonly schemaHash: string;
  readonly intents: Readonly<Record<string, BuiltProcessManagerIntent>>;
  init(): State;
  evolve(
    state: State,
    event: WireEvent,
    ctx: ProcessContext,
  ): BuiltEvolveStep<State> | null;
  onWake?(state: State, ctx: ProcessContext): BuiltEvolveStep<State>;
}

export interface BuiltSubscriber {
  readonly name: string;
  readonly eventTypes: readonly string[];
  handle(event: WireEvent, ctx: HandlerContext): void | Promise<void>;
}

/** Any command, with its declaring vocabulary erased. `BuiltCommand` never
 * uses its `Events` parameter, so erasing it costs nothing. */
export type AnyBuiltCommand = BuiltCommand<EventSchemaMap, z.ZodTypeAny>;

/** What a pipeline's commands look like before `.withCommand` has named any. */
export type CommandMap = Readonly<Record<string, AnyBuiltCommand>>;

export interface BuiltPipeline<
  Name extends string = string,
  Prefix extends string | undefined = string | undefined,
  Commands extends CommandMap = CommandMap,
> {
  readonly name: Name;
  readonly prefix: Prefix;
  readonly eventTypes: readonly string[];
  /** Keyed by the names `.withCommand` was called with, so a caller reaching
   * for one gets its own input type rather than `ZodTypeAny | undefined`. */
  readonly commands: Commands;
  readonly folds: Readonly<Record<string, BuiltFold>>;
  readonly maps: Readonly<Record<string, BuiltMap>>;
  readonly processManagers: Readonly<Record<string, BuiltProcessManager>>;
  readonly subscribers: Readonly<Record<string, BuiltSubscriber>>;
  /** The `.id()` map, applied. The engine is the only caller: it names a
   * fold's lane and a process manager's instance, and the fold executor reads
   * back the same value (ADR-107 decision 4). Throws `ConfigurationError`
   * when `eventType` has no declared extractor. */
  aggregateIdFor(eventType: string, payload: unknown): string;
}

export type { ReplaceStore, AppendStore, MergeStore };
