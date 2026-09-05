/**
 * What a run has to settle about its connected agent targets before it
 * schedules anything.
 *
 * A `connected` target names an agent by `<name>` (the agent in development,
 * or the one other environment it is online in), by `<name>@<environment>`
 * the way the SDK registered it, or by id. A personal development agent belongs to
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
import {
  AgentEnvironmentUnresolvedError,
  AgentOwnerOnlyError,
} from "../connected-agents/errors";
import {
  DEVELOPMENT_ENVIRONMENT,
  parseConnectedReference,
} from "../connected-agents/identity";
import { readAgentPresence } from "../connected-agents/presence.read";
import {
  parseScenarioParameterDefinitions,
  type ScenarioParameterDefinition,
} from "../scenarios/parameters";
import type { RunActor } from "../scenarios/run-actor";
import type { SuiteTarget } from "./types";

/** The reads this module makes, so a test can hand it fixtures. */
export type ConnectedTargetReads = Pick<
  AgentRepository,
  "findConnectedByNameAndEnvironment" | "findConnectedByName"
>;

/** Which of the given agents has a process connected right now. */
export type ConnectedPresenceReads = typeof readAgentPresence;

/** The users store, read only for the display name of an owner. */
export type OwnerNameReads = Pick<PrismaClient, "user">;

/** The row of a reference and the environment it was picked from. */
type ReferencedRow = Pick<
  AgentIdentityRow,
  "id" | "ownerUserId" | "environment"
>;

/**
 * The targets with every `<name>@<environment>` and every `<name>` reference
 * replaced by the id of the agent it names.
 *
 * A development agent registered with a personal key is one row per person,
 * so the actor's own row is the one picked when there is one. Otherwise the
 * shared row for that name and environment, when exactly one exists. A
 * reference that names no such agent is left as written, so the run refuses
 * it as an invalid target reference the way it refuses an unknown id.
 *
 * A name with no environment means the agent in development, where the
 * person improving it runs it. When no process is connected there but one
 * other environment has a process connected, that environment is the one.
 *
 * @throws {AgentEnvironmentUnresolvedError} a name with no environment whose
 *   agent has no process connected anywhere, or has one connected in more
 *   than one environment besides development
 */
export async function resolveConnectedReferences({
  targets,
  projectId,
  actor,
  agents,
  presence = readAgentPresence,
}: {
  targets: readonly SuiteTarget[];
  projectId: string;
  actor: RunActor | undefined;
  agents: ConnectedTargetReads;
  presence?: ConnectedPresenceReads;
}): Promise<SuiteTarget[]> {
  return Promise.all(
    targets.map((target) =>
      resolveConnectedReference({ target, projectId, actor, agents, presence }),
    ),
  );
}

/**
 * One target with its `<name>@<environment>` or `<name>` reference replaced
 * by an agent id. Every other target, and every reference that names no
 * agent, is answered as written.
 */
async function resolveConnectedReference({
  target,
  projectId,
  actor,
  agents,
  presence,
}: {
  target: SuiteTarget;
  projectId: string;
  actor: RunActor | undefined;
  agents: ConnectedTargetReads;
  presence: ConnectedPresenceReads;
}): Promise<SuiteTarget> {
  if (target.type !== "connected") return target;
  const reference = parseConnectedReference(target.referenceId);
  if (reference) {
    const rows = await agents.findConnectedByNameAndEnvironment({
      projectId,
      name: reference.name,
      environment: reference.environment,
    });
    const picked = pickReferencedAgent({ rows, actor });
    return picked ? { ...target, referenceId: picked.id } : target;
  }
  if (target.referenceId.includes("@")) return target;
  const picked = await pickAgentByNameAlone({
    name: target.referenceId,
    projectId,
    actor,
    agents,
    presence,
  });
  return picked ? { ...target, referenceId: picked.id } : target;
}

/**
 * The agent a name with no environment addresses, or nothing when the name
 * is not a connected agent's and is read as an id.
 *
 * Every environment the name is registered in is picked the way a
 * `<name>@<environment>` reference is, then the picks are read for presence.
 * Development wins when a process is connected there; otherwise the one
 * other environment with a process connected.
 */
async function pickAgentByNameAlone({
  name,
  projectId,
  actor,
  agents,
  presence,
}: {
  name: string;
  projectId: string;
  actor: RunActor | undefined;
  agents: ConnectedTargetReads;
  presence: ConnectedPresenceReads;
}): Promise<ReferencedRow | undefined> {
  const rows = await agents.findConnectedByName({ projectId, name });
  if (rows.length === 0) return undefined;
  const registeredEnvironments = [
    ...new Set(rows.map((row) => row.environment ?? DEVELOPMENT_ENVIRONMENT)),
  ];
  const candidates = registeredEnvironments.flatMap((environment) => {
    const picked = pickReferencedAgent({
      rows: rows.filter(
        (row) => (row.environment ?? DEVELOPMENT_ENVIRONMENT) === environment,
      ),
      actor,
    });
    return picked ? [{ environment, row: picked }] : [];
  });
  const presences = await presence({
    projectId,
    agents: candidates.map(({ row }) => ({ id: row.id, type: "connected" })),
  });
  const online = candidates.filter(
    ({ row }) => presences.get(row.id)?.status === "online",
  );
  const development = online.find(
    ({ environment }) => environment === DEVELOPMENT_ENVIRONMENT,
  );
  if (development) return development.row;
  if (online.length === 1) return online[0]?.row;
  throw new AgentEnvironmentUnresolvedError({
    agentName: name,
    registeredEnvironments,
    onlineEnvironments: online.map(({ environment }) => environment),
  });
}

/**
 * The agent row a reference names among the rows that carry its name and
 * environment: the actor's own row when there is one, else the shared row
 * when exactly one exists.
 */
function pickReferencedAgent<
  Row extends Pick<AgentIdentityRow, "ownerUserId">,
>({
  rows,
  actor,
}: {
  rows: readonly Row[];
  actor: RunActor | undefined;
}): Row | undefined {
  const own = actor
    ? rows.find((row) => row.ownerUserId === actor.id)
    : undefined;
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
  agents: readonly Pick<
    AgentIdentityRow,
    "id" | "name" | "type" | "ownerUserId"
  >[];
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
