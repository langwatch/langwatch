import type { AggregateDefinition } from "../domain/definitions.ts";
import type { Event, Projection } from "../domain/types.ts";
import type { ProcessManagerDefinition } from "./processManagerDefinition.ts";
import type { RegisteredCommand, StaticPipelineDefinition } from "./staticBuilder.types.ts";
import type { PipelineMetadata } from "./types.ts";

/** Opens a pipeline definition whose types were sealed at registration (ARCHITECTURE §9). */
export type OpenPipelineDefinition = <R>(
  use: <
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand,
  >(
    definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>,
  ) => R,
) => R;

/** A registered pipeline: what reads without its event type, and the closure opening it typed. */
export interface SealedPipelineDefinition {
  readonly metadata: PipelineMetadata;
  readonly aggregate: AggregateDefinition;
  readonly processManagers: ReadonlyMap<string, ProcessManagerDefinition>;
  readonly open: OpenPipelineDefinition;
}

export function sealPipelineDefinition<
  EventType extends Event,
  ProjectionTypes extends Record<string, Projection>,
  Commands extends RegisteredCommand,
>(
  definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>,
): SealedPipelineDefinition {
  return {
    metadata: definition.metadata,
    aggregate: definition.aggregate,
    processManagers: definition.processManagers,
    open: (use) => use(definition),
  };
}
