/**
 * What a run has to settle about its connected agent targets before it
 * schedules anything (ADR-128).
 * @see specs/agents/connected-agents.feature
 */

import {
  AgentEnvironmentUnresolvedError,
  AgentOwnerOnlyError,
  connectedAgentSelectability,
  DEVELOPMENT_ENVIRONMENT,
  isConnectedAgentStale,
  parseConnectedReference,
} from "@langwatch/agent-contract";
import type { AgentApi } from "@langwatch/agent-contract";
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
type ConnectedAgentRow = {
  id: string;
  ownerUserId?: string | null;
  environment?: string | null;
};

/** The read `resolveConnectedReferences` needs, and nothing more. */
export type ConnectedTargetReferenceReader = Pick<
  AgentApi,
  "getConnectedByNameAndEnvironment" | "getConnectedByName"
>;

/**
 * Which of the given agents has a process connected right now. A name with no
 * environment is answered by presence, so the reader is required to resolve
 * one; a process that composed no connected-agent runtime reads every agent as
 * offline, which refuses such a reference rather than guessing.
 */
export type ConnectedPresenceReader = (input: {
  projectId: string;
  agents: readonly { id: string; type: string }[];
}) => Promise<Map<string, { status: "online" | "offline" }>>;

/** Presence for a process that composed no connected-agent runtime. */
const NO_PRESENCE_READER: ConnectedPresenceReader = async () => new Map();

/**
 * The display names of the owners of the personal agents among these.
 */
export interface AgentOwnerNameReader {
  findNamesByIds(ids: readonly string[]): Promise<Map<string, string | null>>;
}

/**
 * The reads and refusals a run settles about its connected agent targets.
 */
export class ConnectedTargetService {
  static create(): ConnectedTargetService {
    return new ConnectedTargetService();
  }

  private constructor() {}

  /**
   * Refuses the run when one of its agents is a personal development agent of someone other
   * than the actor. The same predicate the listings mark their rows with, so a row a client
   * was told it could choose is never refused here, and one it was told it could not is never
   * accepted.
   */
  static async assertConnectedAgentsRunnable({
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
        agent.type === "connected" &&
        !connectedAgentSelectability({
          ownerUserId: agent.ownerUserId,
          viewerUserId: actor?.id ?? null,
        }).selectable,
    );
    const ownerUserId = foreign?.ownerUserId;
    if (!foreign || !ownerUserId) {
      return;
    }

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
   * holds an `AgentApi` need not read a user store itself.
   */
  static agentOwnerNameReader(agents: Pick<AgentApi, "ownersOf">): AgentOwnerNameReader {
    return {
      async findNamesByIds(ids) {
        const owners = await agents.ownersOf(ids.map((ownerUserId) => ({ ownerUserId })));

        return new Map([...owners].map(([id, owner]) => [id, owner.name]));
      },
    };
  }

  /**
   * The targets with every `<name>@<environment>` and every bare `<name>`
   * reference replaced by the id of the agent it names.
   *
   * A name with no environment means the agent in development, where the
   * person improving it runs it. When no process is connected there but one
   * other environment has one, that environment is the one.
   */
  static async resolveConnectedReferences({
    targets,
    projectId,
    actor,
    agents,
    presence = NO_PRESENCE_READER,
  }: {
    targets: readonly SuiteTarget[];
    projectId: string;
    actor: RunActor | undefined;
    agents: ConnectedTargetReferenceReader;
    presence?: ConnectedPresenceReader;
  }): Promise<SuiteTarget[]> {
    return Promise.all(
      targets.map((target) =>
        resolveConnectedReference({ target, projectId, actor, agents, presence }),
      ),
    );
  }

  /**
   * Whether a target's agent is a connected agent whose process has not been seen for too
   * long.
   */
  static isAgentUnseen(agent: { type?: string; lastSeenAt?: Date | string | null }): boolean {
    return agent.type === "connected" && isConnectedAgentStale({ lastSeenAt: agent.lastSeenAt });
  }

  /**
   * The parameters the agent of a target declares; none for other targets.
   */
  static agentParameterDefinitionsOf(
    agent: { type?: string; config?: unknown } | undefined,
  ): ScenarioParameterDefinition[] {
    if (agent?.type !== "connected") {
      return [];
    }

    const config = agent.config;
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      return [];
    }

    return parseScenarioParameterDefinitions((config as { parameters?: unknown }).parameters);
  }
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
  presence,
}: {
  target: SuiteTarget;
  projectId: string;
  actor: RunActor | undefined;
  agents: ConnectedTargetReferenceReader;
  presence: ConnectedPresenceReader;
}): Promise<SuiteTarget> {
  if (target.type !== "connected") {
    return target;
  }

  const reference = parseConnectedReference(target.referenceId);
  if (reference) {
    const rows = await agents.getConnectedByNameAndEnvironment({
      projectId,
      name: reference.name,
      environment: reference.environment,
    });
    const picked = pickReferencedAgent({ rows, actor });

    return picked ? { ...target, referenceId: picked.id } : target;
  }

  if (target.referenceId.includes("@")) {
    return target;
  }

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
 * The agent a name with no environment addresses, or nothing when the name is
 * not a connected agent's and is read as an id.
 *
 * @throws {AgentEnvironmentUnresolvedError} when no process is connected
 *   anywhere, or when more than one environment besides development has one
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
  agents: ConnectedTargetReferenceReader;
  presence: ConnectedPresenceReader;
}): Promise<ConnectedAgentRow | undefined> {
  const rows = await agents.getConnectedByName({ projectId, name });
  if (rows.length === 0) {
    return undefined;
  }

  const environmentOf = (row: ConnectedAgentRow): string =>
    row.environment ?? DEVELOPMENT_ENVIRONMENT;
  const registeredEnvironments = [...new Set(rows.map(environmentOf))];
  const candidates = registeredEnvironments.flatMap((environment) => {
    const picked = pickReferencedAgent({
      rows: rows.filter((row) => environmentOf(row) === environment),
      actor,
    });

    return picked ? [{ environment, row: picked }] : [];
  });

  const presences = await presence({
    projectId,
    agents: candidates.map(({ row }) => ({ id: row.id, type: "connected" })),
  });
  const online = candidates.filter(({ row }) => presences.get(row.id)?.status === "online");
  const development = online.find(({ environment }) => environment === DEVELOPMENT_ENVIRONMENT);
  if (development) {
    return development.row;
  }

  if (online.length === 1) {
    return online[0]?.row;
  }

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
function pickReferencedAgent({
  rows,
  actor,
}: {
  rows: readonly ConnectedAgentRow[];
  actor: RunActor | undefined;
}): ConnectedAgentRow | undefined {
  const own = actor ? rows.find((row) => row.ownerUserId === actor.id) : undefined;
  if (own) {
    return own;
  }

  const shared = rows.filter((row) => row.ownerUserId === null);

  return shared.length === 1 ? shared[0] : undefined;
}
