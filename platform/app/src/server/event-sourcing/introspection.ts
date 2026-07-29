// ============================================================================
// Introspection — derived from the live EventSourcing runtime
// ============================================================================

import { getApp } from "../app-layer/app";
import type { StaticPipelineDefinition } from "./pipeline/staticBuilder.types";
import {
  generateKillSwitchKey,
  type KillSwitchComponentType,
} from "./utils/killSwitch";

export interface ProjectionMetadata {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
  kind: "fold" | "map";
}

export interface EventSubscriberMetadata {
  subscriberName: string;
  pipelineName: string;
  aggregateType: string;
  /** The event types this subscriber reacts to — its transition triggers. */
  eventTypes: readonly string[];
}

export interface DejaViewProjection {
  projectionName: string;
  eventTypes: readonly string[];
  init: () => unknown;
  apply: (state: unknown, event: { type: string }) => unknown;
}

function getDefinitions(): ReadonlyArray<
  StaticPipelineDefinition<any, any, any>
> {
  return getApp().eventSourcing?.definitions ?? [];
}

export function getProjectionMetadata(): ProjectionMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    const folds = Array.from(def.foldProjections.values()).map(
      ({ definition }) => ({
        projectionName: definition.name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        pauseKey: `${pipelineName}/projection/${definition.name}`,
        kind: "fold" as const,
      }),
    );
    const maps = Array.from(def.mapProjections.values()).map(
      ({ definition }) => ({
        projectionName: definition.name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        // Maps run as `__jobType=handler` in the GroupQueue, so the pause-set
        // entry must use the `handler` segment to match the dispatcher's Lua check.
        pauseKey: `${pipelineName}/handler/${definition.name}`,
        kind: "map" as const,
      }),
    );
    return [...folds, ...maps];
  });
}

/**
 * Event subscribers registered on each pipeline — live consumers of committed
 * events that carry no projection state. This is the DejaView-facing view of
 * the `.withEventSubscriber` seam; the
 * process-manager runtime's generated `pm:<name>` subscribers are internal
 * plumbing and are not part of the static definition, so they are not listed.
 */
export function getEventSubscriberMetadata(): EventSubscriberMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.eventSubscribers.values()).map((definition) => ({
      subscriberName: definition.name,
      pipelineName,
      aggregateType,
      eventTypes: definition.eventTypes,
    }));
  });
}

export interface ProcessManagerMetadata {
  processName: string;
  pipelineName: string;
  aggregateType: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /**
   * Intent types the machine can emit — its cross-aggregate commands, dispatched
   * through the transactional outbox.
   */
  intentTypes: string[];
  /**
   * True for a fixed-interval singleton (one instance, project `__global__`);
   * false for a per-aggregate machine keyed by aggregate id.
   */
  scheduled: boolean;
  /** Fixed wake interval in ms for a scheduled singleton, else null. */
  everyMs: number | null;
  /** True when the machine computes its own wake-ups from within `evolve`. */
  hasWake: boolean;
}

/**
 * The process-manager state machines mounted across the pipelines.
 *
 * The machine itself is implicit in each manager's `evolve` — there is no
 * declared state set or transition table — so what is introspectable is the
 * definition surface: which event types trigger it, which intents it can emit,
 * and how it wakes. The per-aggregate *position* in the machine lives in the
 * persisted instance, read separately by ref.
 */
export function getProcessManagerMetadata(): ProcessManagerMetadata[] {
  return getDefinitions().flatMap((def) => {
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

/**
 * One descriptor per ES kill-switch key that the registered pipelines
 * will generate at runtime. Used by the Ops Feature Flags page to list
 * every togglable kill switch, even ones that have no postgres row yet.
 *
 * Names follow `es-<aggregate>-<componentType>-<componentName>-killswitch`
 * (see src/server/event-sourcing/utils/killSwitch.ts).
 */
export interface KillSwitchDescriptor {
  key: string;
  aggregateType: string;
  componentType: KillSwitchComponentType;
  componentName: string;
  pipelineName: string;
}

/**
 * One entry per kill-switch KEY, carrying every mount that key controls.
 *
 * Descriptors are not unique by key: a subscriber may share one
 * `options.killSwitch.customKey` across several mounts — the billing meter poke
 * rides four pipelines behind a single switch — so the generator emits one
 * descriptor per mount while the operator faces one control. Anything that
 * LISTS switches has to collapse them, or it shows four identical rows and
 * implies four independent controls, inviting someone mid-incident to flip one
 * and wonder why the traffic did not stop.
 *
 * Kept next to the generator on purpose: the duplication is a property of how
 * descriptors are produced, so the fix belongs beside the production rather
 * than in whichever page happens to render them.
 */
export function collapseKillSwitchDescriptorsByKey(
  descriptors: readonly KillSwitchDescriptor[],
): Array<{ key: string; mounts: KillSwitchDescriptor[] }> {
  const byKey = new Map<string, KillSwitchDescriptor[]>();
  for (const descriptor of descriptors) {
    const mounts = byKey.get(descriptor.key);
    if (mounts) mounts.push(descriptor);
    else byKey.set(descriptor.key, [descriptor]);
  }
  return Array.from(byKey, ([key, mounts]) => ({ key, mounts }));
}

/**
 * Human-readable blast radius for one collapsed switch: every pipeline and
 * component the single key stops. During an incident this is the thing an
 * operator needs and cannot otherwise see.
 */
export function describeKillSwitchMounts(
  mounts: readonly KillSwitchDescriptor[],
): string {
  return mounts
    .map((m) => `${m.pipelineName}: ${m.componentType} ${m.componentName}`)
    .join("; ");
}

export function getKillSwitchDescriptors(): KillSwitchDescriptor[] {
  const out: KillSwitchDescriptor[] = [];
  for (const def of getDefinitions()) {
    const { name: pipelineName, aggregateType } = def.metadata;
    for (const { definition } of def.foldProjections.values()) {
      out.push({
        key: `es-${aggregateType}-projection-${definition.name}-killswitch`,
        aggregateType,
        componentType: "projection",
        componentName: definition.name,
        pipelineName,
      });
    }
    for (const { definition } of def.mapProjections.values()) {
      out.push({
        key: `es-${aggregateType}-mapProjection-${definition.name}-killswitch`,
        aggregateType,
        componentType: "mapProjection",
        componentName: definition.name,
        pipelineName,
      });
    }
    for (const cmd of def.commands) {
      out.push({
        key: `es-${aggregateType}-command-${cmd.name}-killswitch`,
        aggregateType,
        componentType: "command",
        componentName: cmd.name,
        pipelineName,
      });
    }
    // Subscribers belong here MORE than the others do, not less: the enqueue
    // seam decides relevance and DISCARDS what it judges irrelevant, and
    // subscriber fan-out is never replayed (ADR-069), so a bad filter loses
    // those events for good. `ops.setFeatureFlag` rejects any key that is
    // neither a registry entry nor a live descriptor, so a switch missing from
    // this list is not merely unlisted — it is unsettable, leaving a revert as
    // the only way to stop the seam it guards.
    //
    // A subscriber may override its key via `options.killSwitch.customKey`;
    // emit the key the router will actually read, or the page would offer one
    // nothing consults.
    for (const definition of def.eventSubscribers.values()) {
      out.push({
        // Generated, never re-spelled: the comment above is the reason. A
        // hand-built key that drifts from `generateKillSwitchKey` is not a
        // cosmetic mismatch — `ops.setFeatureFlag` refuses a key that is
        // neither a registry entry nor a live descriptor, so the switch
        // becomes unsettable.
        key:
          definition.options?.killSwitch?.customKey ??
          generateKillSwitchKey(aggregateType, "subscriber", definition.name),
        aggregateType,
        componentType: "subscriber",
        componentName: definition.name,
        pipelineName,
      });
    }
  }
  return out;
}

export function getDejaViewProjections(): DejaViewProjection[] {
  return getDefinitions().flatMap((def) =>
    Array.from(def.foldProjections.values()).map(({ definition: d }) => ({
      projectionName: d.name,
      eventTypes: d.eventTypes,
      init: () => d.init(),
      apply: (state: unknown, event: { type: string }) =>
        d.apply(state, event as any),
    })),
  );
}
