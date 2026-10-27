import type { AgentCaller } from "@langwatch/agent-contract";
import type { Actor } from "@langwatch/authorization";

/**
 * The caller a version and the deploy check name: the door's user, else the key the request
 * presented (a project key has no owning user), else an unattributed credential.
 */
export function agentCallerOf(input: {
  actor: Actor | null;
  key?: { apiKeyId: string | null } | undefined;
}): AgentCaller {
  const { actor, key } = input;
  if (actor?.type === "user") return { type: "user", id: actor.id };
  if (actor?.type === "api_key") return { type: "api_key", id: actor.id };
  if (actor) return { type: "system" };
  return key?.apiKeyId ? { type: "api_key", id: key.apiKeyId } : { type: "unattributed" };
}
