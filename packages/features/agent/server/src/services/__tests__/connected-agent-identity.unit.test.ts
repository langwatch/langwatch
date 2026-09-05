/**
 * Registration by identity: one row per name and environment, and a
 * reconnect restores a row unseen or archived (ADR-128, "Register and identity").
 * @see specs/agents/connected-agents.feature
 */
import type {
  Agent,
  AgentConfig,
  ConnectedAgentConfig,
  ConnectedAgentIdentity,
  UpdateAgentCommand,
} from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";
import type { AgentsAuditLogPort, AgentsWorkflowPort } from "../../ports/agent.port";
import type { AgentCopyRecord, PersistAgentInput } from "../../repositories/agent.repository";
import { AgentRepository } from "../../repositories/agent.repository";
import { AgentService } from "../agent.service";

function config(overrides: Partial<ConnectedAgentConfig> = {}): ConnectedAgentConfig {
  return {
    parameters: [],
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    ...overrides,
  } as ConnectedAgentConfig;
}

function identity(overrides: Partial<ConnectedAgentIdentity> = {}): ConnectedAgentIdentity {
  return {
    environment: "production",
    ownerUserId: null,
    hostLabel: null,
    identityKey: "support-agent@production",
    ...overrides,
  };
}

/**
 * A repository that upserts by identity key the way Postgres's unique index does: `create`
 * throws a unique-constraint error when a row of that identity key already exists, exactly
 * what `registerConnected`'s race fallback reads.
 */
class MemoryIdentityRepository extends AgentRepository {
  readonly rows: Agent[] = [];
  private nextId = 1;

  async tryFindById(input: { id: string; projectId: string }): Promise<Agent | null> {
    return this.rows.find((a) => a.id === input.id && a.projectId === input.projectId) ?? null;
  }

  async tryFindByIdOnly(id: string): Promise<Agent | null> {
    return this.rows.find((a) => a.id === id) ?? null;
  }

  async tryFindByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Agent | null> {
    return this.rows.find((a) => a.id === input.id && a.projectId === input.projectId) ?? null;
  }

  async findAll(): Promise<Agent[]> {
    return this.rows;
  }

  async findReferenceStates(): Promise<never[]> {
    return [];
  }

  async findNamesByIds(): Promise<never[]> {
    return [];
  }

  async exists(): Promise<boolean> {
    return false;
  }

  async findPage(): Promise<{ data: Agent[]; total: number }> {
    return { data: this.rows, total: this.rows.length };
  }

  async create(input: PersistAgentInput): Promise<Agent> {
    if (input.identity && this.rows.some((a) => a.identityKey === input.identity!.identityKey)) {
      throw Object.assign(new Error("unique constraint"), { code: "P2002" });
    }
    const row = {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      config: input.config,
      workflowId: null,
      copiedFromAgentId: null,
      archivedAt: null,
      createdAt: new Date(this.nextId),
      updatedAt: new Date(this.nextId++),
      environment: input.identity?.environment ?? null,
      ownerUserId: input.identity?.ownerUserId ?? null,
      hostLabel: input.identity?.hostLabel ?? null,
      identityKey: input.identity?.identityKey ?? null,
      lastSeenAt: input.identity ? new Date() : null,
    } as Agent;
    this.rows.push(row);
    return row;
  }

  async update(input: UpdateAgentCommand & { type: string; config?: AgentConfig }): Promise<Agent> {
    const agent = this.rows.find((a) => a.id === input.id && a.projectId === input.projectId);
    if (!agent) throw new Error("not found");
    Object.assign(agent, input);
    return agent;
  }

  async archive(input: { id: string; projectId: string }): Promise<Agent> {
    const agent = this.rows.find((a) => a.id === input.id && a.projectId === input.projectId);
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

  async findByIdentityKey(input: {
    projectId: string;
    identityKey: string;
  }): Promise<Agent | null> {
    return (
      this.rows.find(
        (a) => a.projectId === input.projectId && a.identityKey === input.identityKey,
      ) ?? null
    );
  }

  async findConnectedByNameAndEnvironment(): Promise<Agent[]> {
    return [];
  }

  async reregisterConnected(input: {
    id: string;
    projectId: string;
    name: string;
    config: AgentConfig;
  }): Promise<Agent> {
    const agent = this.rows.find((a) => a.id === input.id && a.projectId === input.projectId);
    if (!agent) throw new Error("not found");
    agent.name = input.name;
    agent.config = input.config;
    agent.archivedAt = null;
    agent.lastSeenAt = new Date();
    return agent;
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

function service(repository: MemoryIdentityRepository) {
  let n = 0;
  return AgentService.create({
    repository,
    workflows: noopWorkflows,
    auditLog: noopAuditLog,
    generateId: () => `agent_generated_${++n}`,
  });
}

describe("AgentService.registerConnected", () => {
  describe("when a process registers an agent name and environment for the first time", () => {
    /** @scenario "A register frame creates one row per agent name and environment" */
    it("creates one connected row for that name and environment", async () => {
      const repository = new MemoryIdentityRepository();
      const agents = service(repository);

      const row = await agents.registerConnected({
        id: "agent_1",
        projectId: "project_1",
        name: "support-agent",
        config: config(),
        identity: identity(),
      });

      expect(row).toMatchObject({
        type: "connected",
        name: "support-agent",
        environment: "production",
      });
      expect(repository.rows).toHaveLength(1);
    });
  });

  describe("when another process registers the same identity with new parameters", () => {
    /** @scenario "A second register of the same identity updates the same row" */
    it("updates the same row instead of creating a second one", async () => {
      const repository = new MemoryIdentityRepository();
      const agents = service(repository);
      const first = await agents.registerConnected({
        id: "agent_1",
        projectId: "project_1",
        name: "support-agent",
        config: config(),
        identity: identity(),
      });

      const second = await agents.registerConnected({
        id: "agent_2",
        projectId: "project_1",
        name: "support-agent-renamed",
        config: config({ timeoutMs: 9_000 } as Partial<ConnectedAgentConfig>),
        identity: identity(),
      });

      expect(second.id).toBe(first.id);
      expect(repository.rows).toHaveLength(1);
      expect(repository.rows[0]).toMatchObject({ name: "support-agent-renamed" });
    });
  });

  describe("when two instances register the same identity at once", () => {
    /** @scenario "Two instances registering together settle on one row" */
    it("both carry the same agent row, and the project holds one agent for that identity", async () => {
      const repository = new MemoryIdentityRepository();
      const agents = service(repository);
      // Neither read the other's row yet: both attempt `create`, and the
      // repository's own unique index decides which one wins.
      const [first, second] = await Promise.all([
        agents.registerConnected({
          id: "agent_a",
          projectId: "project_1",
          name: "support-agent",
          config: config(),
          identity: identity(),
        }),
        agents.registerConnected({
          id: "agent_b",
          projectId: "project_1",
          name: "support-agent",
          config: config(),
          identity: identity(),
        }),
      ]);

      expect(first.id).toBe(second.id);
      expect(repository.rows).toHaveLength(1);
    });
  });

  describe("when a process registers an identity last seen thirty one days ago", () => {
    /** @scenario "A reconnect of an unseen identity lists the row again" */
    it("refreshes the row so it is no longer stale", async () => {
      const repository = new MemoryIdentityRepository();
      const agents = service(repository);
      const existing = await repository.create({
        id: "agent_1",
        projectId: "project_1",
        name: "support-agent",
        type: "connected",
        config: config(),
        identity: identity(),
      });
      existing.lastSeenAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

      const row = await agents.registerConnected({
        id: "agent_1",
        projectId: "project_1",
        name: "support-agent",
        config: config(),
        identity: identity(),
      });

      expect(row.id).toBe(existing.id);
      expect(Date.now() - new Date(row.lastSeenAt as Date).getTime()).toBeLessThan(5_000);
    });
  });

  describe("when a process registers an identity archived by hand", () => {
    /** @scenario "A reconnect of an archived identity restores the row" */
    it("restores the row rather than creating a new one", async () => {
      const repository = new MemoryIdentityRepository();
      const agents = service(repository);
      const existing = await repository.create({
        id: "agent_1",
        projectId: "project_1",
        name: "support-agent",
        type: "connected",
        config: config(),
        identity: identity(),
      });
      await repository.archive({ id: existing.id, projectId: "project_1" });
      expect(repository.rows[0]?.archivedAt).not.toBeNull();

      const row = await agents.registerConnected({
        id: "agent_1",
        projectId: "project_1",
        name: "support-agent",
        config: config(),
        identity: identity(),
      });

      expect(row.id).toBe(existing.id);
      expect(row.archivedAt).toBeNull();
    });
  });
});
