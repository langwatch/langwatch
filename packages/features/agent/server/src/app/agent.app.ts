/**
 * The agent feature's application: what all of its doors call.
 */
import type { AgentService, AgentWithFields } from "@langwatch/agent-contract";
import { nanoid } from "nanoid";
import type {
  AgentTestPort,
  AgentTestRunResult,
  AgentTestTurnResult,
} from "../ports/agent-test.port";
import { AgentService as AgentServiceImplementation } from "../services/agent.service";
import {
  ConnectedAgentPresenceService,
  type AgentPresence,
} from "../services/connected-agent-presence.service";

/** `AgentWithFields.ownerUserId` is optional; the presence view needs it settled. */
function withOwnerUserId<T extends AgentWithFields>(agent: T): T & { ownerUserId: string | null } {
  return { ...agent, ownerUserId: agent.ownerUserId ?? null };
}

/** What the process composes this feature's application from. */
export interface AgentAppDependencies {
  agents: AgentService;
  /**
   * Runs "Test agent" through the Scenario feature's execution pipeline.
   */
  testing?: AgentTestPort;
  /**
   * Reads presence (ADR-128) off the connected-agent runtime. Absent on a
   * process that never installed the runtime (a test double, or a process that composes no
   * connected-agent transport): every agent then reads as offline with no instances, the
   */
  connected?: {
    presence: (input: {
      projectId: string;
      agents: { id: string; type: string }[];
    }) => Promise<Map<string, AgentPresence>>;
  };
}

export class AgentApp {
  static create(dependencies: AgentAppDependencies): AgentApp {
    return new AgentApp(dependencies);
  }

  private constructor(private readonly dependencies: AgentAppDependencies) {}

  /**
   * The platform's agent-id scheme.
   */
  static nextAgentId(): string {
    return `agent_${nanoid()}`;
  }

  /**
   * Every non-archived agent in one project, each carrying what ADR-128
   * added: the parameters a connected agent declares, the owner of a personal one, and its
   * presence. Other kinds read as offline with no instances and no owner.
   */
  async getAll(input: Parameters<AgentService["getAll"]>[0]) {
    const agents = await this.dependencies.agents.getAll(input);
    const owned = agents.map(withOwnerUserId);
    const [owners, presence] = await this.readOwnersAndPresence({
      agents: owned,
      projectId: input.projectId,
    });
    return owned.map((agent) => this.toConnectedView(agent, owners, presence));
  }

  /** One agent, by id, inside one project, carrying the same connected view. */
  async getById(input: Parameters<AgentService["getById"]>[0]) {
    const agent = withOwnerUserId(await this.dependencies.agents.getById(input));
    const [owners, presence] = await this.readOwnersAndPresence({
      agents: [agent],
      projectId: input.projectId,
    });
    return this.toConnectedView(agent, owners, presence);
  }

  /** The declared parameters, owner and presence one agent row carries. */
  private toConnectedView<T extends AgentWithFields & { ownerUserId: string | null }>(
    agent: T,
    owners: Map<string, { userId: string; name: string | null }>,
    presence: Map<string, AgentPresence>,
  ) {
    return {
      ...agent,
      parameters: AgentServiceImplementation.declaredAgentParameters(agent),
      ...ConnectedAgentPresenceService.agentPresenceView({ agent, owners, presence }),
    };
  }

  /** The two reads a connected view is built from, run together. */
  private readOwnersAndPresence({
    agents,
    projectId,
  }: {
    agents: { id: string; type: string; ownerUserId: string | null }[];
    projectId: string;
  }) {
    return Promise.all([
      this.dependencies.agents.ownersOf(agents),
      this.dependencies.connected
        ? this.dependencies.connected.presence({ projectId, agents })
        : Promise.resolve(new Map<string, AgentPresence>()),
    ]);
  }

  /** One page of the project's non-archived agents. */
  list(input: Parameters<AgentService["list"]>[0]) {
    return this.dependencies.agents.list(input);
  }

  /** Stores a new agent. The id is the caller's, or {@link nextAgentId}'s. */
  create(input: Parameters<AgentService["create"]>[0]) {
    return this.dependencies.agents.create(input);
  }

  /** Replaces an agent's stored configuration. */
  update(input: Parameters<AgentService["update"]>[0]) {
    return this.dependencies.agents.update(input);
  }

  /** Soft-deletes one agent. */
  archive(input: Parameters<AgentService["archive"]>[0]) {
    return this.dependencies.agents.archive(input);
  }

  /** What else in the project points at this agent. */
  relatedEntities(input: Parameters<AgentService["relatedEntities"]>[0]) {
    return this.dependencies.agents.relatedEntities(input);
  }

  /** Archives the agent and whatever the archive must take with it. */
  cascadeArchive(input: Parameters<AgentService["cascadeArchive"]>[0]) {
    return this.dependencies.agents.cascadeArchive(input);
  }

  /** Every copy made from one source agent, across projects. */
  getCopies(input: Parameters<AgentService["getCopies"]>[0]) {
    return this.dependencies.agents.getCopies(input);
  }

  /** The agent one copy was made from. */
  getSourceOfCopy(input: Parameters<AgentService["getSourceOfCopy"]>[0]) {
    return this.dependencies.agents.getSourceOfCopy(input);
  }

  /** Copies one agent into another project. */
  copy(input: Parameters<AgentService["copy"]>[0]) {
    return this.dependencies.agents.copy(input);
  }

  /** Pushes a source agent's configuration onto the named copies. */
  pushToCopies(input: Parameters<AgentService["pushToCopies"]>[0]) {
    return this.dependencies.agents.pushToCopies(input);
  }

  /** Pulls the source agent's configuration back onto this copy. */
  syncFromSource(input: Parameters<AgentService["syncFromSource"]>[0]) {
    return this.dependencies.agents.syncFromSource(input);
  }

  /** One agent's edit history. */
  getHistory(input: Parameters<AgentService["getHistory"]>[0]) {
    return this.dependencies.agents.getHistory(input);
  }

  /** The display names of the owners of a set of agents, by owner user id. */
  ownersOf(rows: Parameters<AgentService["ownersOf"]>[0]) {
    return this.dependencies.agents.ownersOf(rows);
  }

  /**
   * Sends one turn to an agent, through the same adapter a simulation turn
   * uses, and answers what it returned.
   */
  async testTurn(input: {
    id: string;
    projectId: string;
    message: string;
    params?: Record<string, string | number | boolean>;
    actorId: string;
  }): Promise<AgentTestTurnResult> {
    const agent = await this.dependencies.agents.getById({
      id: input.id,
      projectId: input.projectId,
    });
    if (!this.dependencies.testing) {
      throw new Error("This process composed no agent test runner, so no turn can be sent.");
    }
    return this.dependencies.testing.sendTurn({
      projectId: input.projectId,
      agent,
      message: input.message,
      params: input.params,
      actor: { id: input.actorId, label: "user" },
    });
  }

  /**
   * Schedules one scripted "Test agent" run, saving nothing, and answers with
   * the run's ids so the caller can open the run drawer on it.
   */
  async testRun(input: {
    agentId: string;
    projectId: string;
    actorId: string;
  }): Promise<AgentTestRunResult> {
    const agent = await this.dependencies.agents.getById({
      id: input.agentId,
      projectId: input.projectId,
    });
    if (!this.dependencies.testing) {
      throw new Error("This process composed no agent test runner, so no run can be scheduled.");
    }
    return this.dependencies.testing.scheduleRun({
      projectId: input.projectId,
      agent,
      actor: { id: input.actorId, label: "user" },
    });
  }
}
