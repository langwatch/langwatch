/**
 * What a run has to settle about its connected agent targets before it
 * schedules anything.
 *
 * A `connected` target names an agent by id, or by `<name>@<environment>`
 * the way the SDK registered it. A personal development agent belongs to
 * the person whose key registered it, so a run started by anyone else, or by
 * no person at all, is refused before a job exists. The agent's own
 * parameters join the scenarios' declarations for the run, and its
 * environment and owner name are what its label reads.
 *
 * @see specs/agents/connected-agents.feature
 * @see dev/docs/adr/128-connected-agents.md
 */

import type { PrismaClient } from "~/generated/prisma/client";
import type {
  AgentIdentityRow,
  AgentRepository,
} from "../agents/agent.repository";
import { isConnectedAgentStale } from "../agents/connected-agent-visibility";
import { AgentOwnerOnlyError } from "../connected-agents/errors";
import { parseConnectedReference } from "../connected-agents/identity";
import {
  parseScenarioParameterDefinitions,
  type ScenarioParameterDefinition,
} from "../scenarios/parameters";
import type { RunActor } from "../scenarios/run-actor";
import type { SuiteTarget } from "./types";

/** The reads this module makes, so a test can hand it fixtures. */
export type ConnectedTargetReads = Pick<
  AgentRepository,
  "findConnectedByNameAndEnvironment"
>;

/** The users store, read only for the display name of an owner. */
export type OwnerNameReads = Pick<PrismaClient, "user">;

/**
 * The targets with every `<name>@<environment>` reference replaced by the id
 * of the agent it names.
 *
 * A development agent registered with a personal key is one row per person,
 * so the actor's own row is the one picked when there is one. Otherwise the
 * shared row for that name and environment, when exactly one exists. A
 * reference that names no such agent is left as written, so the run refuses
 * it as an invalid target reference the way it refuses an unknown id.
 */
export async function resolveConnectedReferences({
  targets,
  projectId,
  actor,
  agents,
}: {
  targets: readonly SuiteTarget[];
  projectId: string;
  actor: RunActor | undefined;
  agents: ConnectedTargetReads;
}): Promise<SuiteTarget[]> {
  return Promise.all(
    targets.map(async (target) => {
      if (target.type !== "connected") return target;
      const reference = parseConnectedReference(target.referenceId);
      if (!reference) return target;
      const rows = await agents.findConnectedByNameAndEnvironment({
        projectId,
        name: reference.name,
        environment: reference.environment,
      });
      const own = actor
        ? rows.find((row) => row.ownerUserId === actor.id)
        : undefined;
      const shared = rows.filter((row) => row.ownerUserId === null);
      const picked = own ?? (shared.length === 1 ? shared[0] : undefined);
      return picked ? { ...target, referenceId: picked.id } : target;
    }),
  );
}

/**
 * Whether a target's agent is a connected agent whose process has not been
 * seen for too long.
 *
 * Such a target is refused the way an archived one is: the run reports it as
 * skipped rather than reaching a process that is gone.
 */
export function isAgentUnseen(
  agent: Pick<AgentIdentityRow, "type" | "lastSeenAt">,
): boolean {
  return (
    agent.type === "connected" &&
    isConnectedAgentStale({ lastSeenAt: agent.lastSeenAt })
  );
}

/**
 * Refuses the run when one of its agents is a personal development agent of
 * someone other than the actor.
 *
 * A run with no actor at all, one started with a legacy project key, has no
 * person to match, so a personal agent refuses it too. The refusal names the
 * owner, so the customer reads who to ask.
 */
export async function assertConnectedAgentsRunnable({
  agents,
  actor,
  users,
}: {
  agents: readonly AgentIdentityRow[];
  actor: RunActor | undefined;
  users: OwnerNameReads;
}): Promise<void> {
  const foreign = agents.find(
    (agent) =>
      agent.type === "connected" &&
      agent.ownerUserId !== null &&
      agent.ownerUserId !== actor?.id,
  );
  if (!foreign?.ownerUserId) return;
  const names = await ownerNamesOf({ agents: [foreign], users });
  throw new AgentOwnerOnlyError({
    agentId: foreign.id,
    agentName: foreign.name,
    ownerUserId: foreign.ownerUserId,
    ownerName: names.get(foreign.ownerUserId) ?? null,
  });
}

/**
 * The parameters the agent of a target declares; none for other targets.
 *
 * Read tolerantly off the raw config, the way a scenario's own column is: a
 * row whose declarations this version does not understand runs with none.
 */
export function agentParameterDefinitionsOf(
  agent: AgentIdentityRow | undefined,
): ScenarioParameterDefinition[] {
  if (agent?.type !== "connected") return [];
  const config = agent.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return [];
  }
  return parseScenarioParameterDefinitions(config.parameters);
}

/** The display names of the owners of the personal agents among these. */
export async function ownerNamesOf({
  agents,
  users,
}: {
  agents: readonly { ownerUserId: string | null }[];
  users: OwnerNameReads;
}): Promise<Map<string, string | null>> {
  const ownerIds = [
    ...new Set(
      agents
        .map((agent) => agent.ownerUserId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (ownerIds.length === 0) return new Map();
  const rows = await users.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}
