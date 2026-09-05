/**
 * A connected agent's identity, config and type are the SDK's to write, not a caller's:
 * (ADR-128, "A connected agent cannot be edited by hand").
 * @see specs/agents/connected-agents.feature
 */
import type {
  Agent,
  AgentConfig,
  ConnectedAgentConfig,
  UpdateAgentCommand,
} from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";
import type { AgentsAuditLogPort, AgentsWorkflowPort } from "../../ports/agent.port";
import type { AgentCopyRecord, PersistAgentInput } from "../../repositories/agent.repository";
import { AgentRepository } from "../../repositories/agent.repository";
import { AgentService } from "../agent.service";

function connectedAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent_1",
    projectId: "project_1",
    name: "support-agent",
    type: "connected",
    config: {
      parameters: [],
      sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    } as AgentConfig,
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    environment: "production",
    ownerUserId: null,
    hostLabel: null,
    identityKey: "support-agent@production",
    lastSeenAt: new Date(0),
    ...overrides,
  } as Agent;
}

class MemoryAgentRepository extends AgentRepository {
  constructor(private agents: Agent[]) {
    super();
  }

  async tryFindById(input: { id: string; projectId: string }): Promise<Agent | null> {
    return (
      this.agents.find(
        (a) => a.id === input.id && a.projectId === input.projectId && !a.archivedAt,
      ) ?? null
    );
  }

  async tryFindByIdOnly(id: string): Promise<Agent | null> {
    return this.agents.find((a) => a.id === id && !a.archivedAt) ?? null;
  }

  async tryFindByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Agent | null> {
    return this.agents.find((a) => a.id === input.id && a.projectId === input.projectId) ?? null;
  }

  async findAll(): Promise<Agent[]> {
    return this.agents;
  }

  async findReferenceStates(): Promise<never[]> {
    return [];
  }

  async findNamesByIds(): Promise<never[]> {
    return [];
  }

  async exists(input: { id: string; projectId: string }): Promise<boolean> {
    return this.agents.some((a) => a.id === input.id && a.projectId === input.projectId);
  }

  async findPage(): Promise<{ data: Agent[]; total: number }> {
    return { data: this.agents, total: this.agents.length };
  }

  async create(input: PersistAgentInput): Promise<Agent> {
    const { identity, type, ...rest } = input;
    const agent = connectedAgent({
      ...rest,
      ...identity,
      type: type as "connected",
      config: input.config as ConnectedAgentConfig,
    });
    this.agents.push(agent);
    return agent;
  }

  async update(input: UpdateAgentCommand & { type: string; config?: AgentConfig }): Promise<Agent> {
    const agent = this.agents.find((a) => a.id === input.id && a.projectId === input.projectId);
    if (!agent) throw new Error("not found");
    Object.assign(agent, input);
    return agent;
  }

  async archive(input: { id: string; projectId: string }): Promise<Agent> {
    const agent = this.agents.find((a) => a.id === input.id && a.projectId === input.projectId);
    if (!agent) throw new Error("not found");
    agent.archivedAt = new Date();
    return agent;
  }

  async findCopies(): Promise<AgentCopyRecord[]> {
    return [];
  }

  async updateNameAndConfig(): Promise<void> {
    /* not used by these scenarios */
  }

  async tryFindByIdentityKey(): Promise<Agent | null> {
    return null;
  }

  async findConnectedByNameAndEnvironment(): Promise<Agent[]> {
    return [];
  }

  async reregisterConnected(): Promise<Agent> {
    throw new Error("not used by these scenarios");
  }

  async touchLastSeenAt(): Promise<void> {
    /* not used by these scenarios */
  }

  async findUserNamesByIds(): Promise<Map<string, string | null>> {
    return new Map();
  }
}

const noopWorkflows: AgentsWorkflowPort = {
  fields: async () => ({}),
  related: async () => null,
  copy: async () => ({ workflowId: "workflow_copy" }),
  archive: async ({ workflowId }) => ({ id: workflowId }),
  remove: async () => undefined,
};

const noopAuditLog: AgentsAuditLogPort = { history: async () => [] };

function service(agents: Agent[]) {
  return AgentService.create({
    repository: new MemoryAgentRepository(agents),
    workflows: noopWorkflows,
    auditLog: noopAuditLog,
  });
}

describe("AgentService create/update against a connected agent", () => {
  describe("when a caller creates an agent of type connected", () => {
    /** @scenario "A connected agent cannot be created by hand" */
    it("refuses the request with agent_register_only", async () => {
      const agents = service([]);

      await expect(
        agents.create({
          projectId: "project_1",
          name: "support-agent",
          type: "connected",
          config: { parameters: [], sdk: { name: "x", version: "1", language: "python" } },
        }),
      ).rejects.toMatchObject({ code: "agent_register_only" });
    });
  });

  describe("when an archived connected agent is renamed by hand", () => {
    /** @scenario "An archived connected agent is still registered from code" */
    it("refuses the rename and keeps the row's registered name", async () => {
      const row = connectedAgent({ archivedAt: new Date() });
      const agents = service([row]);

      await expect(
        agents.update({ id: row.id, projectId: row.projectId, name: "renamed" }),
      ).rejects.toMatchObject({ code: "agent_register_only" });
      expect(row.name).toBe("support-agent");
    });
  });

  describe("when a connected agent is archived through the REST agents API", () => {
    /** @scenario "A connected agent can be archived, and nothing else edited" */
    it("archives the row, and still refuses a config or type edit", async () => {
      const row = connectedAgent();
      const agents = service([row]);

      const archived = await agents.archive({ id: row.id, projectId: row.projectId });
      expect(archived.archivedAt).not.toBeNull();

      await expect(
        agents.update({
          id: row.id,
          projectId: row.projectId,
          config: { parameters: [], sdk: { name: "x", version: "2", language: "python" } },
        }),
      ).rejects.toMatchObject({ code: "agent_register_only" });
      await expect(
        agents.update({ id: row.id, projectId: row.projectId, type: "signature" }),
      ).rejects.toMatchObject({ code: "agent_register_only" });
    });
  });
});
