import type {
  Agent,
  AgentConfig,
  AgentName,
  AgentReferenceState,
  AgentType,
  UpdateAgentCommand,
} from "@langwatch/agents-contract";
import type { AgentsDatabase } from "../../ports/agent.port";
import type { AgentCopyRecord, PersistAgentInput } from "../agent.repository";
import { AgentRepository } from "../agent.repository";
import { mapAgentRow, type AgentRow } from "./prisma.agent.mapper";

type AgentCopyRow = {
  id: string;
  name: string;
  projectId: string;
  project: {
    name: string;
    team: { name: string; organization: { name: string } };
  };
};

export class PrismaAgentRepository extends AgentRepository {
  static create(database: AgentsDatabase): PrismaAgentRepository {
    return new PrismaAgentRepository(database);
  }

  private constructor(private readonly database: AgentsDatabase) {
    super();
  }

  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<Agent | null> {
    const row = await this.database.agent.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
    });
    return this.mapOptionalRow(row);
  }

  async findByIdOnly(id: string): Promise<Agent | null> {
    const row = await this.database.agent.findFirst({
      where: { id, archivedAt: null },
    });
    return this.mapOptionalRow(row);
  }

  async findAll(input: { projectId: string }): Promise<Agent[]> {
    const rows = await this.database.agent.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { copiedAgents: true } } },
    });
    return rows.map((row) => mapAgentRow(row as AgentRow));
  }

  async findReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentReferenceState[]> {
    return (await this.database.agent.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, archivedAt: true },
    })) as AgentReferenceState[];
  }

  async findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentName[]> {
    return (await this.database.agent.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, name: true },
    })) as AgentName[];
  }

  async exists(input: { id: string; projectId: string }): Promise<boolean> {
    const row = await this.database.agent.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async findPage(input: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ data: Agent[]; total: number }> {
    const where = { projectId: input.projectId, archivedAt: null };
    const [rows, total] = await Promise.all([
      this.database.agent.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.database.agent.count({ where }),
    ]);
    return {
      data: rows.map((row) => mapAgentRow(row as AgentRow)),
      total,
    };
  }

  async create(input: PersistAgentInput): Promise<Agent> {
    const data: Record<string, unknown> = {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      config: input.config,
    };
    if (input.workflowId !== undefined) data.workflowId = input.workflowId;
    if (input.copiedFromAgentId !== undefined) {
      data.copiedFromAgentId = input.copiedFromAgentId;
    }
    const row = await this.database.agent.create({ data });
    return mapAgentRow(row as AgentRow);
  }

  async update(
    input: UpdateAgentCommand & { type: AgentType; config?: AgentConfig },
  ): Promise<Agent> {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type;
    if (input.config !== undefined) data.config = input.config;
    if (input.workflowId !== undefined) data.workflowId = input.workflowId;
    const row = await this.database.agent.update({
      where: { id: input.id, projectId: input.projectId },
      data,
    });
    return mapAgentRow(row as AgentRow);
  }

  async archive(input: { id: string; projectId: string }): Promise<Agent> {
    const row = await this.database.agent.update({
      where: { id: input.id, projectId: input.projectId },
      data: { archivedAt: new Date() },
    });
    return mapAgentRow(row as AgentRow);
  }

  async findCopies(sourceAgentId: string): Promise<AgentCopyRecord[]> {
    const rows = (await this.database.agent.findMany({
      where: { copiedFromAgentId: sourceAgentId, archivedAt: null },
      select: {
        id: true,
        name: true,
        projectId: true,
        project: {
          select: {
            name: true,
            team: {
              select: {
                name: true,
                organization: { select: { name: true } },
              },
            },
          },
        },
      },
    })) as AgentCopyRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      projectId: row.projectId,
      fullPath: `${row.project.team.organization.name} / ${row.project.team.name} / ${row.project.name}`,
    }));
  }

  async updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: AgentConfig;
  }): Promise<void> {
    await this.database.agent.update({
      where: { id: input.id, projectId: input.projectId },
      data: { name: input.name, config: input.config },
    });
  }

  private mapOptionalRow(row: unknown): Agent | null {
    if (!row) return null;
    return mapAgentRow(row as AgentRow);
  }
}
