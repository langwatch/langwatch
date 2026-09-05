/**
 * What a run has to settle about its connected agent targets before it
 * schedules anything (ADR-128).
 * @see specs/agents/connected-agents.feature
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
   * than the actor.
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
        agent.type === "connected" && agent.ownerUserId != null && agent.ownerUserId !== actor?.id,
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
   * holds an `AgentService` need not read a user store itself.
   */
  static agentOwnerNameReader(agents: Pick<AgentService, "ownersOf">): AgentOwnerNameReader {
    return {
      async findNamesByIds(ids) {
        const owners = await agents.ownersOf(ids.map((ownerUserId) => ({ ownerUserId })));

        return new Map([...owners].map(([id, owner]) => [id, owner.name]));
      },
    };
  }

  /**
   * The targets with every `<name>@<environment>` reference replaced by the id of the agent
   * it names.
   */
  static async resolveConnectedReferences({
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
}: {
  target: SuiteTarget;
  projectId: string;
  actor: RunActor | undefined;
  agents: ConnectedTargetReferenceReader;
}): Promise<SuiteTarget> {
  if (target.type !== "connected") {
    return target;
  }

  const reference = parseConnectedReference(target.referenceId);
  if (!reference) {
    return target;
  }

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
  if (own) {
    return own;
  }

  const shared = rows.filter((row) => row.ownerUserId === null);

  return shared.length === 1 ? shared[0] : undefined;
}
