import type { SealedCommand } from "../commands/sealedCommand.ts";
import type { AggregateDefinition } from "../domain/definitions.ts";
import type { Event, Projection } from "../domain/types.ts";
import type { KillSwitchOptions } from "../kill-switch/killSwitchKeys.ts";
import type {
  FoldProjectionDefinition,
  FoldProjectionOptions,
} from "../projections/foldProjection.types.ts";
import type {
  MapProjectionDefinition,
  MapProjectionOptions,
} from "../projections/mapProjection.types.ts";
import type {
  SealedFoldProjection,
  SealedMapProjection,
  SealedStateProjection,
} from "../projections/sealedProjection.ts";
import type { StateProjectionDefinition } from "../projections/stateProjection.types.ts";
import type { DeduplicationStrategy } from "../queues/queue.types.ts";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types.ts";
import type { SubscriberDispatchDefinition } from "../subscribers/subscriber.types.ts";
import type { ProcessManagerDefinition } from "./processManagerDefinition.ts";
import type { PipelineMetadata } from "./types.ts";

/**
 * Queue serialization and append-coalescing options (ADR-066 pillar 2), shared
 * by both {@link CommandHandlerOptions} declarations. Declared once so both
 * interfaces extend it rather than hand-syncing two copies.
 */
export interface CommandSerializationOptions<Payload = any> {
  /**
   * Serialize this command with every other command enabling the option for
   * the same tenant and aggregate, keeping command handling, event append and
   * projection staging atomic — other aggregates still run concurrently.
   */
  serializeByAggregate?: boolean;
  /** Coalesce appends when aggregate produces events faster than they drain; see ADR-066. */
  coalesceMaxBatch?: number | ((payload: Payload) => number);
  /**
   * Optional byte cap for a coalesced batch (ADR-066 pillar 2). The drain
   * stops before a job that would exceed it (a too-large job dispatches on
   * its own); only consulted when `coalesceMaxBatch` enables coalescing.
   */
  coalesceMaxBytes?: number;
}

/**
 * Options for configuring a command handler in a static pipeline definition.
 */
export interface CommandHandlerOptions<Payload = any> extends CommandSerializationOptions<Payload> {
  /**
   * Operator stop for this component, resolved per tenant at dispatch time.
   * Absent means the generated key; a `customKey` must also be what the
   * descriptors advertise or the switch cannot be set.
   */
  killSwitch?: KillSwitchOptions;
  getAggregateId?: (payload: Payload) => string;
  getGroupKey?: (payload: Payload) => string;
  makeJobId?: (payload: Payload) => string;
  delay?: number;
  concurrency?: number;
  deduplication?: DeduplicationStrategy<Payload>;
  spanAttributes?: (payload: Payload) => Record<string, string | number | boolean>;
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

/** Static pipeline definition importable without runtime dependencies. */
export interface StaticPipelineDefinition<
  EventType extends Event = Event,
  _ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
  RegisteredCommands extends RegisteredCommand = NoCommands,
> {
  /** The aggregate and complete event vocabulary owned by this pipeline. */
  aggregate: AggregateDefinition;

  /** Pipeline metadata for introspection and tooling */
  metadata: PipelineMetadata;

  /**
   * Process-composed payload preparation between durable event storage and
   * live projection/subscriber dispatch. The event store always receives the
   * original event.
   */
  prepareEventForProjection?: (event: EventType) => EventType;

  /** Fold projections (stateful, reduce events into state) registered in this pipeline */
  foldProjections: Map<
    string,
    SealedFoldProjection<EventType> & { options?: FoldProjectionOptions }
  >;

  /** Postgres operational state projections registered by the pipeline. */
  stateProjections?: Map<string, SealedStateProjection<EventType>>;

  /** Map projections (stateless, transform individual events) registered in this pipeline */
  mapProjections: Map<string, SealedMapProjection<EventType> & { options?: MapProjectionOptions }>;

  /** Command handlers registered in this pipeline */
  commands: SealedCommand<EventType>[];

  /** Subscribers attached to fold projections (post-fold side-effect handlers) */
  foldSubscribers: Map<
    string,
    {
      projectionName: string;
      definition: SubscriberDispatchDefinition<EventType>;
    }
  >;

  /** Subscribers attached to map projections (post-map side-effect handlers) */
  mapSubscribers: Map<
    string,
    {
      projectionName: string;
      definition: SubscriberDispatchDefinition<EventType>;
    }
  >;

  /** Live event consumers that are independent of fold/map projections. */
  eventSubscribers: Map<string, EventSubscriberDefinition<EventType>>;

  /** Process managers mounted on this pipeline (ADR-049/052). */
  processManagers: Map<string, ProcessManagerDefinition>;

  /** Type-level marker for registered commands (not used at runtime) */
  readonly _registeredCommands?: RegisteredCommands;
}
