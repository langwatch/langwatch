import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type { CommandHandlerClass } from "../commands/commandHandlerClass";
import type { Event, Projection } from "../domain/types";
import type { FoldProjectionDefinition, FoldProjectionOptions } from "../projections/foldProjection.types";
import type { MapProjectionDefinition, MapProjectionOptions } from "../projections/mapProjection.types";
import type { DeduplicationStrategy } from "../queues/queue.types";
import type { ReactorDefinition } from "../reactors/reactor.types";
import type { PipelineMetadata } from "./types";

/**
 * Kill switch options for event sourcing components.
 * When the feature flag is true, the component is disabled.
 */
export interface KillSwitchOptions {
  /** Optional custom feature flag key override */
  customKey?: string;
  /** Default value if feature flag service unavailable */
  defaultValue?: boolean;
}

/**
 * Options for configuring a command handler in a static pipeline definition.
 */
export interface CommandHandlerOptions<Payload = any> {
  getAggregateId?: (payload: Payload) => string;
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
    options?: CommandHandlerOptions;
  }>;

  /** Reactors (post-fold side-effect handlers) registered in this pipeline */
  reactors: Map<
    string,
    { foldName: string; definition: ReactorDefinition<EventType> }
  >;

  /** Feature flag service for kill switches */
  featureFlagService?: FeatureFlagServiceInterface;

  /** Type-level marker for registered commands (not used at runtime) */
  readonly _registeredCommands?: RegisteredCommands;
}
