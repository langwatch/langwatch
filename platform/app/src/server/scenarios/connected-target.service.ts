/**
 * Resolving a connected agent as the target of a run.
 *
 * A run may name a connected agent by its `<name>@<environment>` reference
 * rather than by id, so the target is resolved once here before anything is
 * scheduled: the reference becomes the agent's id, the actor is checked
 * against the agent's owner, and the agent's own declared parameters come
 * back beside it.
 *
 * The router calls this and never reaches the repository itself.
 *
 * @see dev/docs/adr/128-connected-agents.md
 * @see specs/agents/connected-agents.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { AgentRepository } from "~/server/agents/agent.repository";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
import type { RunActor } from "~/server/scenarios/run-actor";
import {
  agentParameterDefinitionsOf,
  assertConnectedAgentsRunnable,
  resolveConnectedReferences,
} from "~/server/suites/connected-targets";
import type { SimulationTarget } from "./simulation-target";

/**
 * The target as the run should record it, and what the agent declares.
 *
 * A target that is not a connected agent comes back as written, with no
 * declarations, so the caller needs no branch of its own.
 *
 * A connected agent whose reference names nothing is also left as written:
 * the validation prefetch refuses it the way it refuses any unknown target.
 *
 * @throws {AgentOwnerOnlyError} when the agent is a personal development
 *   agent of someone else.
 */
export async function resolveConnectedTarget({
  prisma,
  projectId,
  target,
  actor,
}: {
  prisma: PrismaClient;
  projectId: string;
  target: SimulationTarget;
  actor: RunActor;
}): Promise<{
  target: SimulationTarget;
  targetDefinitions: ScenarioParameterDefinition[];
}> {
  if (target.type !== "connected") return { target, targetDefinitions: [] };
  const agents = new AgentRepository(prisma);
  const [resolved] = await resolveConnectedReferences({
    targets: [target],
    projectId,
    actor,
    agents,
  });
  const named = resolved ?? target;
  const rows = await agents.findManyIncludingArchived({
    ids: [named.referenceId],
    projectId,
  });
  const agent = rows.find((row) => row.archivedAt === null);
  await assertConnectedAgentsRunnable({
    agents: agent ? [agent] : [],
    actor,
    users: prisma,
  });
  return {
    target: { type: named.type, referenceId: named.referenceId },
    targetDefinitions: agentParameterDefinitionsOf(agent),
  };
}
