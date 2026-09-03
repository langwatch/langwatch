/**
 * What a run has to settle about its connected agent targets before it
 * schedules anything.
 *
 * A `connected` target names an agent the SDK registered from the customer's
 * own code (ADR-128). A personal development agent belongs to the person
 * whose key registered it and runs on that person's own machine, so a run
 * started by anyone else — or by no person at all, which a project key is —
 * is refused before a job exists.
 *
 * @see specs/agents/connected-agents.feature
 * @see dev/docs/adr/128-connected-agents.md
 */

import { AgentOwnerOnlyError } from "@langwatch/agent-contract";
import type { RunActor } from "@langwatch/scenario-contract";

/** What this module reads about an agent, and nothing more. */
export type ConnectedTargetAgent = {
  id: string;
  name: string;
  type: string;
  ownerUserId?: string | null;
};

/**
 * The display names of the owners of the personal agents among these.
 *
 * A port rather than a Prisma client: this module belongs to the run path,
 * which holds no data access of its own. A caller with no reader hands none
 * and the refusal names the owner by id alone.
 */
export interface AgentOwnerNameReader {
  findNamesByIds(ids: readonly string[]): Promise<Map<string, string | null>>;
}

/**
 * Refuses the run when one of its agents is a personal development agent of
 * someone other than the actor.
 *
 * A run with no actor at all, one started with a project key, has no person to
 * match, so a personal agent refuses it too. The refusal names the owner, so
 * the customer reads who to ask.
 *
 * @throws {AgentOwnerOnlyError} when an agent belongs to another person
 */
export async function assertConnectedAgentsRunnable({
  agents,
  actor,
  owners,
}: {
  agents: readonly ConnectedTargetAgent[];
  actor: RunActor | undefined;
  /** Absent when the caller has no user store; the refusal then names no name. */
  owners?: AgentOwnerNameReader;
}): Promise<void> {
  const foreign = agents.find(
    (agent) =>
      agent.type === "connected" && agent.ownerUserId != null && agent.ownerUserId !== actor?.id,
  );
  const ownerUserId = foreign?.ownerUserId;
  if (!foreign || !ownerUserId) return;

  const names = await owners?.findNamesByIds([ownerUserId]);
  throw new AgentOwnerOnlyError({
    agentId: foreign.id,
    agentName: foreign.name,
    ownerUserId,
    ownerName: names?.get(ownerUserId) ?? null,
  });
}
