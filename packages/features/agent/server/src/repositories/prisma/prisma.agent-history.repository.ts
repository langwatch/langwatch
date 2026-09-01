import type { AgentHistoryEntry } from "@langwatch/agent-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AgentsAuditLogPort } from "../../ports/agent.port";

/**
 * One agent's edit history, read out of the project's audit log.
 *
 * Agents keep no history table of their own: what a customer sees on the
 * history drawer is the subset of the project's audit entries whose action is
 * an `agents.` one and whose recorded arguments name this agent. That is a
 * plain read over two tables, so it is this package's to own rather than a
 * reason to receive the agent service from a process that already had one.
 *
 * The authors are resolved in a second query rather than through a relation:
 * `AuditLog.userId` is a bare column with no foreign key — an entry survives
 * the user who wrote it — so there is no join to include, and an entry naming
 * a user who no longer exists reports no user instead of dropping the entry.
 */
export class PrismaAgentHistoryRepository implements AgentsAuditLogPort {
  static create(database: PrismaClient): PrismaAgentHistoryRepository {
    return new PrismaAgentHistoryRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {}

  async history(input: {
    agentId: string;
    projectId: string;
    limit: number;
  }): Promise<AgentHistoryEntry[]> {
    const entries = await this.database.auditLog.findMany({
      where: {
        projectId: input.projectId,
        action: { startsWith: "agents." },
        // The three places an `agents.` entry can name this agent: as the
        // subject of the action, as the source an operation was performed
        // from, and as the copy an operation produced. All three are this
        // agent's history — a copy made FROM it is part of what happened to
        // it — so all three argument shapes are matched.
        OR: [
          { args: { path: ["id"], equals: input.agentId } },
          { args: { path: ["agentId"], equals: input.agentId } },
          { args: { path: ["newAgentId"], equals: input.agentId } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });

    const authorsById = await this.authors(entries.map((entry) => entry.userId));
    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      createdAt: entry.createdAt,
      args: entry.args,
      user: entry.userId ? (authorsById.get(entry.userId) ?? null) : null,
    }));
  }

  private async authors(
    userIds: readonly (string | null)[],
  ): Promise<Map<string, { id: string; name: string | null; email: string | null }>> {
    const named = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (named.length === 0) return new Map();

    const users = await this.database.user.findMany({
      where: { id: { in: named } },
      select: { id: true, name: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }
}
