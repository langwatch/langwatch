import type { FeatureFlagKey } from "../../featureFlag/registry";
import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type { CommandHandlerClass } from "../commands/commandHandlerClass";
import type { Event, Projection } from "../domain/types";
import type {
  FoldProjectionDefinition,
  FoldProjectionOptions,
} from "../projections/foldProjection.types";
import type {
  MapProjectionDefinition,
  MapProjectionOptions,
} from "../projections/mapProjection.types";
import type { StateProjectionDefinition } from "../projections/stateProjection.types";
import type { DeduplicationStrategy } from "../queues/queue.types";
import type { ReactorDefinition } from "../reactors/reactor.types";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import type { ProcessManagerDefinition } from "./processManagerDefinition";
import type { PipelineMetadata } from "./types";

/**
 * Kill switch options for event sourcing components.
 * When the feature flag is true, the component is disabled.
 */
export interface KillSwitchOptions {
  /**
   * Optional custom feature flag key override. Must satisfy
   * `FeatureFlagKey` so the registry catches unregistered keys at
   * compile time; pass a registered explicit flag or an
   * `es-*-killswitch` template-literal key.
   */
  customKey?: FeatureFlagKey;
  /** Default value if feature flag service unavailable */
  defaultValue?: boolean;
}

/**
 * Queue serialization and append-coalescing options (ADR-066 pillar 2), shared
 * by both {@link CommandHandlerOptions} declarations — the static-pipeline
 * builder's here and the dispatcher's runtime shape. Declared once so the JSDoc
 * for these fields lives in a single place; both interfaces extend it rather
 * than hand-syncing two copies.
 */
export interface CommandSerializationOptions<Payload = any> {
  /**
   * Serialize this command with every other command that enables the option
   * for the same tenant and aggregate. This keeps command handling, event
   * append, and projection staging atomic with respect to the next command
   * for that aggregate while allowing other aggregates to run concurrently.
   */
  serializeByAggregate?: boolean;
  /**
   * Coalesce this producer's appends (ADR-066 pillar 2). When one aggregate can
   * mint events faster than they drain — a hot trigger recording every match —
   * set the max number of same-command jobs (including the dispatched one) to
   * fold into a single multi-row insert. Leave unset (or ≤ 1) for a low-fan-in
   * producer where one aggregate appends at most one event per human action:
   * those append immediately, with the per-job path unchanged.
   *
   * Pass a resolver when the bound depends on the individual payload. The
   * drain's byte budget weighs each job by its QUEUED size, so a payload that
   * expands after dequeue — one carrying a reference whose content is fetched
   * during handling — is invisible to that budget and must cap itself at 1.
   */
  coalesceMaxBatch?: number | ((payload: Payload) => number);
  /**
   * Optional byte cap for a coalesced batch (ADR-066 pillar 2). The drain stops
   * before a job that would push the batch past this size, keeping one insert
   * inside the downstream flush budget; a job too large to fit becomes its own
   * dispatch. Unset falls back to the GroupQueue default. Only consulted when
   * `coalesceMaxBatch` enables coalescing.
   */
  coalesceMaxBytes?: number;
}

/**
 * Options for configuring a command handler in a static pipeline definition.
 */
export interface CommandHandlerOptions<Payload = any>
  extends CommandSerializationOptions<Payload> {
  getAggregateId?: (payload: Payload) => string;
  getGroupKey?: (payload: Payload) => string;
  makeJobId?: (payload: Payload) => string;
  delay?: number;
  concurrency?: number;
  deduplication?: DeduplicationStrategy<Payload>;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
}

/**
 * Represents a registered command with its name and payload type.
 */
export type RegisteredCommand = {
  name: string;
  payload: unknown;
};

/**
 * Default type for when no commands are registered.
 */
export type NoCommands = never;

/**
 * Static pipeline definition that can be imported without runtime dependencies.
 * Contains metadata and projection/handler definitions but no connection to infrastructure.
 *
 * @example
 * ```typescript
 * const definition = definePipeline<MyEvent>()
 *   .withName("my-pipeline")
 *   .withAggregateType("entity")
 *   .withFoldProjection("summary", summaryProjection)
 *   .build();
 * ```
 */
export interface StaticPipelineDefinition<
  EventType extends Event = Event,
  _ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
  RegisteredCommands extends RegisteredCommand = NoCommands,
> {
  /** Pipeline metadata for introspection and tooling */
  metadata: PipelineMetadata;

  /** Fold projections (stateful, reduce events into state) registered in this pipeline */
  foldProjections: Map<
    string,
    {
      definition: FoldProjectionDefinition<any, EventType>;
      options?: FoldProjectionOptions;
    }
  >;

  /** Default operational state projections registered via `.withProjection()`. */
  stateProjections?: Map<string, StateProjectionDefinition<any, EventType>>;

  /** Map projections (stateless, transform individual events) registered in this pipeline */
  mapProjections: Map<
    string,
    {
      definition: MapProjectionDefinition<any, EventType>;
      options?: MapProjectionOptions;
    }
  >;

  /** Command handlers registered in this pipeline */
  commands: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    /** Pre-constructed instance — when provided, queueManager uses this instead of `new handlerClass()`. */
    handlerInstance?: import("../commands/command").CommandHandler<
      any,
      EventType
    >;
    options?: CommandHandlerOptions;
  }>;

  /** Reactors attached to fold projections (post-fold side-effect handlers) */
  foldReactors: Map<
    string,
    { projectionName: string; definition: ReactorDefinition<EventType> }
  >;

  /** Reactors attached to map projections (post-map side-effect handlers) */
  mapReactors: Map<
    string,
    { projectionName: string; definition: ReactorDefinition<EventType> }
  >;

  /** Live event consumers that are independent of fold/map projections. */
  eventSubscribers: Map<string, EventSubscriberDefinition<EventType>>;

  /** Process managers mounted on this pipeline (ADR-049/052). */
  processManagers: Map<string, ProcessManagerDefinition>;

  /** Feature flag service for kill switches */
  featureFlagService?: FeatureFlagServiceInterface;

  /** Type-level marker for registered commands (not used at runtime) */
  readonly _registeredCommands?: RegisteredCommands;
}
