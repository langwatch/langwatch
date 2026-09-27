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
  parseConnectedReference,
} from "@langwatch/agent-contract";
import type { AgentApi } from "@langwatch/agent-contract";
import type { RunActor } from "@langwatch/scenario-contract";
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
 * Which of the given agents has a process connected right now. A name with
 * no environment resolves by presence; a process with no connected-agent
 * runtime reads every agent as offline, refusing such a reference rather than guessing.
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
  /** Over an `AgentApi`, which answers both the references and the owner names. */
  static create({
    agents,
    presence = NO_PRESENCE_READER,
    owners,
  }: {
    agents: ConnectedTargetReferenceReader;
    presence?: ConnectedPresenceReader;
    /** Absent when the caller has no user store; a refusal then names no name. */
    owners?: AgentOwnerNameReader;
  }): ConnectedTargetService {
    return new ConnectedTargetService(agents, presence, owners);
  }

  private constructor(
    private readonly agents: ConnectedTargetReferenceReader,
    private readonly presence: ConnectedPresenceReader,
    private readonly owners: AgentOwnerNameReader | undefined,
  ) {}

  /**
   * Refuses the run when an agent is someone else's personal dev agent — the
   * same predicate the listings mark rows with, so a row the client was told
   * it could choose is never refused, and one it couldn't is never accepted.
   */
  async assertConnectedAgentsRunnable({
    agents,
    actor,
  }: {
    agents: readonly ConnectedTargetAgent[];
    actor: RunActor | undefined;
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

    const names = await this.owners?.findNamesByIds([ownerUserId]);

    throw new AgentOwnerOnlyError({
      agentId: foreign.id,
      agentName: foreign.name,
      ownerUserId,
      ownerName: names?.get(ownerUserId) ?? null,
    });
  }

  /**
   * The targets with every `<name>@<environment>` and every bare `<name>`
   * reference replaced by the connected agent's id. No environment means
   * development; if none is connected there, the one other connected environment is used.
   */
  resolveConnectedReferences({
    targets,
    projectId,
    actor,
  }: {
    targets: readonly SuiteTarget[];
    projectId: string;
    actor: RunActor | undefined;
  }): Promise<SuiteTarget[]> {
    const { agents, presence } = this;
    return Promise.all(
      targets.map((target) =>
        resolveConnectedReference({ target, projectId, actor, agents, presence }),
      ),
    );
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
    const picked =
      pickReferencedAgent({ rows, actor }) ?? pickForeignPersonalAgent({ rows, actor });

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
 * The agent a name with no environment addresses, or nothing when it reads as an id. Another
 * person's online personal agent is picked when nothing runnable is, to be refused as owner-only.
 * @throws {AgentEnvironmentUnresolvedError} when no process is connected anywhere, or when more
 *   than one environment besides development has one */
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
    const inEnvironment = rows.filter((row) => environmentOf(row) === environment);
    const picked = pickReferencedAgent({ rows: inEnvironment, actor });
    if (picked) {
      return [{ environment, row: picked, foreign: false }];
    }

    const foreign = pickForeignPersonalAgent({ rows: inEnvironment, actor });

    return foreign ? [{ environment, row: foreign, foreign: true }] : [];
  });

  const presences = await presence({
    projectId,
    agents: candidates.map(({ row }) => ({ id: row.id, type: "connected" })),
  });
  const online = candidates.filter(
    ({ row, foreign }) => !foreign && presences.get(row.id)?.status === "online",
  );
  const development = online.find(({ environment }) => environment === DEVELOPMENT_ENVIRONMENT);
  if (development) {
    return development.row;
  }

  if (online.length === 1) {
    return online[0]?.row;
  }

  if (online.length === 0) {
    const foreignOnline = candidates.find(
      ({ row, foreign }) => foreign && presences.get(row.id)?.status === "online",
    );
    if (foreignOnline) {
      return foreignOnline.row;
    }
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

/**
 * Another person's personal agent among the rows carrying a reference's name and
 * environment, picked only when nothing the caller may run is: the run is then refused
 * as owner-only, naming the owner, rather than "not found" for a visibly running process.
 */
function pickForeignPersonalAgent({
  rows,
  actor,
}: {
  rows: readonly ConnectedAgentRow[];
  actor: RunActor | undefined;
}): ConnectedAgentRow | undefined {
  return rows.find((row) => row.ownerUserId !== null && row.ownerUserId !== actor?.id);
}
