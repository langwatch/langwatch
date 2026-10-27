import type { AgentCaller } from "@langwatch/agent-contract";
import type { Actor } from "@langwatch/authorization";

/**
 * The caller a version and the archive deploy check name, from the door's actor. Every
 * agent route authenticates, so a missing actor is a wiring defect.
 */
export function agentCallerOf(actor: Actor | null): AgentCaller {
  if (actor === null) throw new Error("An agent write reached the door without an actor");
  if (actor.type === "user") return { type: "user", id: actor.id };
  if (actor.type === "api_key") return { type: "api_key", id: actor.id };
  return { type: "system" };
}
