import { randomUUID } from "node:crypto";
import { env } from "node:process";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaAuditLogRepository } from "../prisma.audit-log.repository.ts";

class TestQueryGuard extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor) {
    return next(context.args);
  }
}

const databaseUrl = env.DATABASE_URL;
const projectId = `audit_history_${randomUUID()}`;
const otherProjectId = `${projectId}_other`;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new TestQueryGuard() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

describe.skipIf(!databaseUrl)("persisted audit entity history", () => {
  afterAll(async () => {
    if (!connection) return;
    try {
      await connection.client.auditLog.deleteMany({
        where: { projectId: { in: [projectId, otherProjectId] } },
      });
    } finally {
      await connection.closeOnce();
    }
  });

  it("matches all entity argument keys while excluding other tenants, entities and actions", async () => {
    if (!connection) throw new Error("DATABASE_URL is required for audit integration tests");
    const database = connection.client;
    const argumentNames = ["id", "agentId", "newAgentId"];
    const entries = Array.from({ length: 103 }, (_, index) => ({
      id: `${projectId}_${index}`,
      projectId,
      action: "agents.copy",
      userId: index % 2 === 0 ? "deleted-author" : null,
      createdAt: new Date(index * 1000),
      args: { [argumentNames[index % 3]!]: "agent-1" },
    }));
    await database.auditLog.createMany({
      data: [
        ...entries,
        {
          id: `${projectId}_tenant`,
          projectId: otherProjectId,
          action: "agents.copy",
          args: { id: "agent-1" },
        },
        { id: `${projectId}_entity`, projectId, action: "agents.copy", args: { id: "agent-2" } },
        {
          id: `${projectId}_action`,
          projectId,
          action: "projects.update",
          args: { id: "agent-1" },
        },
      ],
    });

    const history = await PrismaAuditLogRepository.create({ prisma: database }).findEntityHistory({
      projectId,
      actionPrefix: "agents.",
      entityId: "agent-1",
      argumentNames,
      limit: 100,
    });

    expect(history.map((entry) => entry.id)).toEqual(
      entries
        .slice(3)
        .reverse()
        .map((entry) => entry.id),
    );
    expect(history[0]).toEqual({
      id: `${projectId}_102`,
      userId: "deleted-author",
      action: "agents.copy",
      createdAt: new Date(102000),
      args: { id: "agent-1" },
    });
    expect(history[1]?.userId).toBeNull();
  });
});
