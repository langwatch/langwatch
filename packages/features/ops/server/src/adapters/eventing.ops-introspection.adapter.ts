import type { StaticPipelineDefinition } from "@langwatch/eventing";
import {
  OpsEventingIntrospectionPort,
  type OpsDejaViewProjection,
  type OpsProcessManagerMetadata,
  type OpsProjectionMetadata,
} from "../ports/eventing-introspection.port";

type AnyPipelineDefinition = StaticPipelineDefinition<any, any, any>;

/**
 * Reads the pipeline definitions the process composed. The definitions are
 * resolved lazily on every call because a composition registers pipelines
 * during boot and an explorer may be built before the last one lands.
 */
export class EventingOpsIntrospectionAdapter extends OpsEventingIntrospectionPort {
  private constructor(private readonly definitions: () => ReadonlyArray<AnyPipelineDefinition>) {
    super();
  }

  static create(
    definitions: () => ReadonlyArray<AnyPipelineDefinition>,
  ): EventingOpsIntrospectionAdapter {
    return new EventingOpsIntrospectionAdapter(definitions);
  }

  projections(): OpsProjectionMetadata[] {
    return this.definitions().flatMap((def) => {
      const { name: pipelineName, aggregateType } = def.metadata;
      const folds = Array.from(def.foldProjections.values()).map(({ definition }) => ({
        projectionName: definition.name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        pauseKey: `${pipelineName}/projection/${definition.name}`,
        kind: "fold" as const,
      }));
      const maps = Array.from(def.mapProjections.values()).map(({ definition }) => ({
        projectionName: definition.name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        // Maps run as `__jobType=handler` in the GroupQueue, so the pause-set
        // entry must use the `handler` segment to match the dispatcher's Lua check.
        pauseKey: `${pipelineName}/handler/${definition.name}`,
        kind: "map" as const,
      }));
      const states = Array.from(def.stateProjections?.entries() ?? []).map(([name]) => ({
        projectionName: name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        // State projections enqueue with `__jobType=stateProjection`; the
        // dispatcher matches the pause key against that raw segment.
        pauseKey: `${pipelineName}/stateProjection/${name}`,
        kind: "state" as const,
      }));
      return [...folds, ...maps, ...states];
    });
  }

  processManagers(): OpsProcessManagerMetadata[] {
    return this.definitions().flatMap((def) => {
      const { name: pipelineName, aggregateType } = def.metadata;
      return Array.from(def.processManagers.values()).map(({ config }) => ({
        processName: config.name,
        pipelineName,
        aggregateType,
        eventTypes: config.eventTypes,
        intentTypes: Object.keys(config.intents ?? {}),
        scheduled: Boolean(config.schedule),
        everyMs: config.schedule?.everyMs ?? null,
        hasWake: Boolean(config.onWake),
      }));
    });
  }

  dejaViewProjections(): OpsDejaViewProjection[] {
    return this.definitions().flatMap((def) =>
      Array.from(def.foldProjections.values()).map(({ definition: d }) => ({
        projectionName: d.name,
        eventTypes: d.eventTypes,
        init: () => d.init(),
        apply: (state: unknown, event: { type: string }) => d.apply(state, event as any),
      })),
    );
  }
}
