import { generate } from "@langwatch/ksuid";

/**
 * The app's KSUID resource for an agent row (`KSUID_RESOURCES.AGENT`). The
 * literal rather than the app's constant table: the prefix is part of the
 * id format already written to the database, so it belongs with the writer.
 */
const AGENT_KSUID_RESOURCE = "agent";

/** The platform's agent-id scheme used by legacy transport adapters. */
export function nextAgentId(): string {
  return generate(AGENT_KSUID_RESOURCE).toString();
}
