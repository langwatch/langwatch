import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Exactly the delegate methods the audit-log backfill calls, PICKED from the
 * real client rather than re-declared, so a typed `PrismaClient` satisfies it
 * with no cast and every row type comes from its own call site.
 */
type Delegate<Model extends keyof PrismaClient, Methods extends keyof PrismaClient[Model]> = Pick<
  PrismaClient[Model],
  Methods
>;

export type AgentAuditLogBackfillDatabase = {
  auditLog: Delegate<"auditLog", "findMany" | "update">;
  agent: Delegate<"agent", "findMany">;
};

export type AgentAuditLogRow = Prisma.AuditLogGetPayload<{
  select: { id: true; projectId: true; createdAt: true; args: true };
}>;

export type AgentAuditLogArgs = Prisma.JsonObject;

export type AgentAuditLogArgsInput = Prisma.InputJsonObject;

export type AgentAuditLogArgsValue = Prisma.JsonValue;

export type AgentAuditLogCandidateAgent = { id: string };

/**
 * The read/patch surface the audit-log id backfill needs: the logs missing an
 * id for a given action, the agents that could be the one it means, and the
 * write that patches a resolved id back onto the log.
 */
export class AgentAuditLogBackfillRepository {
  private constructor(private readonly database: AgentAuditLogBackfillDatabase) {}

  static create({
    database,
  }: {
    database: AgentAuditLogBackfillDatabase;
  }): AgentAuditLogBackfillRepository {
    return new AgentAuditLogBackfillRepository(database);
  }

  findLogsByAction(action: string): Promise<AgentAuditLogRow[]> {
    return this.database.auditLog.findMany({
      where: { action },
      select: { id: true, projectId: true, createdAt: true, args: true },
    });
  }

  findCandidateAgents({
    projectId,
    window,
    copiedFromAgentId,
  }: {
    projectId: string;
    window: { gte: Date; lte: Date };
    copiedFromAgentId?: string;
  }): Promise<AgentAuditLogCandidateAgent[]> {
    return this.database.agent.findMany({
      where: { projectId, createdAt: window, copiedFromAgentId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  }

  async patchLogArgs({
    logId,
    args,
  }: {
    logId: string;
    args: AgentAuditLogArgsInput;
  }): Promise<void> {
    await this.database.auditLog.update({ where: { id: logId }, data: { args } });
  }
}
