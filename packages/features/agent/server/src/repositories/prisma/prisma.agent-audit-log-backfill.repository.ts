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
