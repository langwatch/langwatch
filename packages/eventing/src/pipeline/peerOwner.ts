import { ConfigurationError } from "../services/errorHandling.ts";
import type { SealedPipelineDefinition } from "./sealedPipeline.ts";

/**
 * The one registered pipeline declaring every event type a peer lane consumes: the owner whose
 * event log it re-folds and replays from. Refuses a type no pipeline declares, and types spread
 * over several owners, since one aggregate's history lives under one aggregate type (§9).
 */
export function peerOwnerOf({
  definitions,
  lane,
  eventTypes,
}: {
  definitions: readonly SealedPipelineDefinition[];
  lane: string;
  eventTypes: readonly string[];
}): SealedPipelineDefinition {
  const declares = (definition: SealedPipelineDefinition, type: string): boolean =>
    definition.aggregate.events.some((event) => event.type === type);
  const unknown = eventTypes.filter((type) => !definitions.some((owner) => declares(owner, type)));
  if (unknown.length > 0) {
    throw new ConfigurationError(
      "EventSourcing",
      `Peer projection "${lane}" consumes [${unknown.join(", ")}], which no registered pipeline declares. ` +
        "Register the owner's pipeline in this process, or name the owner contract's current event type.",
      { projection: lane, unknown },
    );
  }
  const owners = definitions.filter((owner) => eventTypes.some((type) => declares(owner, type)));
  const [owner] = owners;
  if (!owner || owners.length > 1) {
    throw new ConfigurationError(
      "EventSourcing",
      `Peer projection "${lane}" consumes events of several owner pipelines ` +
        `[${owners.map(({ metadata }) => metadata.name).join(", ")}]; declare one peer projection per owner.`,
      { projection: lane },
    );
  }
  return owner;
}
