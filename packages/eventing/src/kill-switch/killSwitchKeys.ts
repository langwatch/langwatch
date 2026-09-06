import type { AggregateType } from "../domain/aggregateType.ts";

/**
 * The four kinds of pipeline component an operator can stop. State
 * projections report as `projection` because the router reuses the
 * fold-shaped key for them.
 */
export type KillSwitchComponentType = "projection" | "mapProjection" | "command" | "subscriber";

/** The generated shape every event-sourcing kill switch key takes. */
export type EsKillSwitchKey = `es-${string}-${string}-${string}-killswitch`;

/** A component's opt-out from the generated key. */
export interface KillSwitchOptions {
  /**
   * Key the runtime consults instead of the generated one. It must also be
   * what the descriptors advertise, or the switch is unsettable.
   */
  customKey?: string;
}

/**
 * The feature-flag key for one component's kill switch:
 * `es-<aggregate>-<componentType>-<componentName>-killswitch`.
 */
export function generateKillSwitchKey(
  aggregateType: AggregateType | string,
  componentType: KillSwitchComponentType,
  componentName: string,
): EsKillSwitchKey {
  return `es-${String(aggregateType)}-${componentType}-${componentName}-killswitch`;
}

/** One togglable switch the live pipeline graph will read at runtime. */
export interface KillSwitchDescriptor {
  key: string;
  aggregateType: string;
  componentType: KillSwitchComponentType;
  componentName: string;
  pipelineName: string;
}

/** A named component carrying its optional switch override. */
export interface KillSwitchComponent {
  name?: string;
  options?: { killSwitch?: KillSwitchOptions };
}

/** The components of a pipeline definition that carry a kill switch. */
export interface KillSwitchComponentSource {
  metadata: { name: string; aggregateType: string };
  foldProjections: Map<string, { definition: KillSwitchComponent }>;
  mapProjections: Map<string, { definition: KillSwitchComponent }>;
  stateProjections?: Map<string, { options?: { killSwitch?: KillSwitchOptions } }>;
  commands: ReadonlyArray<{ name: string; options?: { killSwitch?: KillSwitchOptions } }>;
  eventSubscribers: Map<string, KillSwitchComponent>;
}

/**
 * Every kill-switch key one pipeline definition will generate at runtime.
 * Generated, never re-spelled: a write refuses a key that is neither a
 * registry entry nor a live descriptor, so a drifting key is unsettable.
 */
export function killSwitchDescriptorsFor(
  definition: KillSwitchComponentSource,
): KillSwitchDescriptor[] {
  const { name: pipelineName, aggregateType } = definition.metadata;
  const descriptors: KillSwitchDescriptor[] = [];

  const push = (
    componentType: KillSwitchComponentType,
    componentName: string,
    options: KillSwitchOptions | undefined,
  ): void => {
    descriptors.push({
      key: options?.customKey ?? generateKillSwitchKey(aggregateType, componentType, componentName),
      aggregateType,
      componentType,
      componentName,
      pipelineName,
    });
  };

  for (const [name, entry] of definition.foldProjections) {
    push("projection", entry.definition.name ?? name, entry.definition.options?.killSwitch);
  }
  for (const [name, entry] of definition.mapProjections) {
    push("mapProjection", entry.definition.name ?? name, entry.definition.options?.killSwitch);
  }
  for (const [name, projection] of definition.stateProjections ?? []) {
    push("projection", name, projection?.options?.killSwitch);
  }
  for (const command of definition.commands) {
    push("command", command.name, command.options?.killSwitch);
  }
  // Subscribers belong here most of all: their enqueue seam discards what it
  // judges irrelevant and is never replayed, so a bad filter loses events for
  // good and a revert would be the only way to stop it.
  for (const [name, subscriber] of definition.eventSubscribers) {
    push("subscriber", subscriber.name ?? name, subscriber.options?.killSwitch);
  }

  return descriptors;
}
