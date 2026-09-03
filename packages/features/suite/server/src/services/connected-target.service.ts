/**
 * What a run has to settle about its connected agent targets before it
 * schedules anything.
 *
 * A `connected` target names an agent by id, or by `<name>@<environment>`
 * the way the SDK registered it, the customer's own code (ADR-128). A
 * personal development agent belongs to the person whose key registered it
 * and runs on that person's own machine, so a run started by anyone else —
 * or by no person at all, which a project key is — is refused before a job
 * exists. An agent not seen in a while is treated as gone.
 *
 * @see specs/agents/connected-agents.feature
 * @see dev/docs/adr/128-connected-agents.md
 */

import {
  AgentOwnerOnlyError,
  isConnectedAgentStale,
  parseConnectedReference,
} from "@langwatch/agent-contract";
import type { AgentService } from "@langwatch/agent-contract";
import type { RunActor } from "@langwatch/scenario-contract";
import {
  parseScenarioParameterDefinitions,
  type ScenarioParameterDefinition,
} from "@langwatch/scenario-contract";
import type { SuiteTarget } from "@langwatch/suite-contract";

/** What this module reads about an agent, and nothing more. */
export type ConnectedTargetAgent = {
  id: string;
  name: string;
  type: string;
  ownerUserId?: string | null;
};

/** The row a name-and-environment reference is resolved against. */
type ConnectedAgentRow = { id: string; ownerUserId?: string | null };

/** The read `resolveConnectedReferences` needs, and nothing more. */
export type ConnectedTargetReferenceReader = Pick<AgentService, "getConnectedByNameAndEnvironment">;

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

/**
 * Bridges `AgentService.ownersOf` (agent-server's own read of the owner
 * names) to the `AgentOwnerNameReader` port above, so a caller that already
 * holds an `AgentService` need not read a user store itself. Main's
 * `ownerNamesOf` read `prisma.user` directly; the branch already has this
 * read as a service method, so the module wraps it instead of restating it.
 */
export function agentOwnerNameReader(agents: Pick<AgentService, "ownersOf">): AgentOwnerNameReader {
  return {
    async findNamesByIds(ids) {
      const owners = await agents.ownersOf(ids.map((ownerUserId) => ({ ownerUserId })));
      return new Map([...owners].map(([id, owner]) => [id, owner.name]));
    },
  };
}

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
  agents: ConnectedTargetReferenceReader;
}): Promise<SuiteTarget[]> {
  return Promise.all(
    targets.map((target) => resolveConnectedReference({ target, projectId, actor, agents })),
  );
}

/**
 * One target with its `<name>@<environment>` reference replaced by an agent
 * id. Every other target, and every reference that names no agent, is
 * answered as written.
 */
async function resolveConnectedReference({
  target,
  projectId,
  actor,
  agents,
}: {
  target: SuiteTarget;
  projectId: string;
  actor: RunActor | undefined;
  agents: ConnectedTargetReferenceReader;
}): Promise<SuiteTarget> {
  if (target.type !== "connected") return target;
  const reference = parseConnectedReference(target.referenceId);
  if (!reference) return target;
  const rows = await agents.getConnectedByNameAndEnvironment({
    projectId,
    name: reference.name,
    environment: reference.environment,
  });
  const picked = pickReferencedAgent({ rows, actor });
  return picked ? { ...target, referenceId: picked.id } : target;
}

/**
 * The agent row a reference names among the rows that carry its name and
 * environment: the actor's own row when there is one, else the shared row
 * when exactly one exists.
 */
function pickReferencedAgent({
  rows,
  actor,
}: {
  rows: readonly ConnectedAgentRow[];
  actor: RunActor | undefined;
}): ConnectedAgentRow | undefined {
  const own = actor ? rows.find((row) => row.ownerUserId === actor.id) : undefined;
  if (own) return own;
  const shared = rows.filter((row) => row.ownerUserId === null);
  return shared.length === 1 ? shared[0] : undefined;
}

/**
 * Whether a target's agent is a connected agent whose process has not been
 * seen for too long.
 *
 * Such a target is refused the way an archived one is: the run reports it as
 * skipped rather than reaching a process that is gone.
 */
export function isAgentUnseen(agent: {
  type?: string;
  lastSeenAt?: Date | string | null;
}): boolean {
  return agent.type === "connected" && isConnectedAgentStale({ lastSeenAt: agent.lastSeenAt });
}

/**
 * The parameters the agent of a target declares; none for other targets.
 *
 * Read tolerantly off the raw config, the way a scenario's own column is: a
 * row whose declarations this version does not understand runs with none.
 */
export function agentParameterDefinitionsOf(
  agent: { type?: string; config?: unknown } | undefined,
): ScenarioParameterDefinition[] {
  if (agent?.type !== "connected") return [];
  const config = agent.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return [];
  }
  return parseScenarioParameterDefinitions((config as { parameters?: unknown }).parameters);
}
