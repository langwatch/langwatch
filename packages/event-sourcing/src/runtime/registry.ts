import { ConfigurationError } from "../errors";
import type { BuiltPipeline } from "../pipeline/pipeline.types";
import type { RegisteredPipeline, Registry } from "./contracts";

/**
 * The registry (ADR-108 decision 1): every registered pipeline, indexed once
 * at registration, and the whole introspection surface. There is no separate
 * router and no separate introspection module — what is registered, what
 * subscribes to what, and whether the graph resolves are all answered here.
 */

interface Member {
  readonly pipeline: BuiltPipeline;
  readonly name: string;
}

function indexMembers(
  index: Map<string, Member[]>,
  pipeline: BuiltPipeline,
  members: Readonly<Record<string, { readonly name: string; readonly eventTypes: readonly string[] }>>,
): void {
  for (const member of Object.values(members)) {
    for (const eventType of member.eventTypes) {
      const existing = index.get(eventType);
      const entry: Member = { pipeline, name: member.name };
      if (existing) existing.push(entry);
      else index.set(eventType, [entry]);
    }
  }
}

/** A pipeline registry, plus one capability beyond the frozen `Registry`
 * interface: a caller can bind a command port ahead of the owning pipeline's
 * registration, and `assertResolvable` names every port still unresolved once
 * every pipeline has registered (ADR-108 §13's cross-pipeline command bridge,
 * boot-time half — specs/event-sourcing/command-bus.feature). */
export interface PipelineRegistry extends Registry {
  bindCommandPort(commandName: string): void;
}

export function createRegistry(): PipelineRegistry {
  const registered: RegisteredPipeline[] = [];
  const commandOwners = new Map<string, { pipeline: BuiltPipeline; command: string }>();
  const eventTypeOwners = new Map<string, string>();
  const foldIndex = new Map<string, Member[]>();
  const mapIndex = new Map<string, Member[]>();
  const subscriberIndex = new Map<string, Member[]>();
  const processManagerIndex = new Map<string, Member[]>();
  const boundCommandPorts = new Set<string>();

  function assertNoCommandCollision(pipeline: BuiltPipeline): void {
    for (const command of Object.keys(pipeline.commands)) {
      const existing = commandOwners.get(command);
      if (existing) {
        throw new ConfigurationError(
          `command "${command}" is registered by both pipeline "${existing.pipeline.name}" and pipeline "${pipeline.name}"`,
          { command, pipelines: [existing.pipeline.name, pipeline.name] },
        );
      }
    }
  }

  function assertNoEventTypeCollision(pipeline: BuiltPipeline): void {
    for (const eventType of pipeline.eventTypes) {
      const owner = eventTypeOwners.get(eventType);
      if (owner !== undefined) {
        throw new ConfigurationError(
          `event type "${eventType}" is derived by both pipeline "${owner}" and pipeline "${pipeline.name}"`,
          { eventType, pipelines: [owner, pipeline.name] },
        );
      }
    }
  }

  return {
    register(pipeline) {
      assertNoCommandCollision(pipeline);
      assertNoEventTypeCollision(pipeline);

      for (const eventType of pipeline.eventTypes) eventTypeOwners.set(eventType, pipeline.name);
      for (const command of Object.keys(pipeline.commands)) {
        commandOwners.set(command, { pipeline, command });
      }
      indexMembers(foldIndex, pipeline, pipeline.folds);
      indexMembers(mapIndex, pipeline, pipeline.maps);
      indexMembers(subscriberIndex, pipeline, pipeline.subscribers);
      indexMembers(processManagerIndex, pipeline, pipeline.processManagers);

      registered.push({ pipeline, aggregateType: pipeline.name });
    },

    all() {
      return registered;
    },

    commandNames() {
      return [...commandOwners.keys()];
    },

    findCommand(name) {
      return commandOwners.get(name) ?? null;
    },

    subscribersFor(eventType) {
      return subscriberIndex.get(eventType) ?? [];
    },

    foldsFor(eventType) {
      return foldIndex.get(eventType) ?? [];
    },

    mapsFor(eventType) {
      return mapIndex.get(eventType) ?? [];
    },

    processManagersFor(eventType) {
      return processManagerIndex.get(eventType) ?? [];
    },

    bindCommandPort(commandName) {
      boundCommandPorts.add(commandName);
    },

    assertResolvable() {
      const unresolved = [...boundCommandPorts]
        .filter((name) => !commandOwners.has(name))
        .sort();
      if (unresolved.length > 0) {
        throw new ConfigurationError(
          `no registered pipeline owns command(s): ${unresolved.join(", ")}`,
          { commands: unresolved },
        );
      }
    },
  };
}
