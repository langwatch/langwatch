import type { AgentCaller } from "@langwatch/agent-contract";
import type { Actor } from "@langwatch/authorization";

/** The caller a version and the archive deploy check name, from the door's actor. */
export function agentCallerOf(actor: Actor | null): AgentCaller | undefined {
  if (actor === null) return void 0;
  if (actor.type === "user") return { type: "user", id: actor.id };
  if (actor.type === "api_key") return { type: "api_key", id: actor.id };
  return { type: "system" };
}
