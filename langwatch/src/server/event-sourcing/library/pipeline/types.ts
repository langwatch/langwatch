import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { PipelineMetadata } from "../../runtime/pipeline/types";
import type { CommandHandlerClass } from "../commands/commandHandlerClass";
import type { EventHandlerClass } from "../domain/handlers/eventHandlerClass";
import type { ProjectionHandlerClass } from "../domain/handlers/projectionHandlerClass";
import type { Event, ParentLink, Projection } from "../domain/types";
import type { EventHandlerOptions } from "../eventHandler.types";
import type { ProjectionOptions } from "../projection.types";

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
 * Contains metadata and handler classes but no connection to infrastructure.
 *
 * @example
 * ```typescript
 * const definition = definePipeline<MyEvent>()
 *   .withName("my-pipeline")
 *   .withAggregateType("entity")
 *   .withProjection("summary", SummaryHandler)
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

  /** Projection handlers registered in this pipeline */
  projections: Map<
    string,
    {
      handlerClass: ProjectionHandlerClass<EventType, any>;
      options?: ProjectionOptions;
    }
  >;

  /** Event handlers registered in this pipeline */
  eventHandlers: Map<
    string,
    {
      handlerClass: EventHandlerClass<EventType>;
      options?: EventHandlerOptions<EventType>;
    }
  >;

  /** Command handlers registered in this pipeline */
  commands: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions;
  }>;

  /** Parent links for navigating to related aggregates */
  parentLinks: Array<ParentLink<EventType>>;

  /** Feature flag service for kill switches */
  featureFlagService?: FeatureFlagServiceInterface;

  /** Type-level marker for registered commands (not used at runtime) */
  readonly _registeredCommands?: RegisteredCommands;
}
