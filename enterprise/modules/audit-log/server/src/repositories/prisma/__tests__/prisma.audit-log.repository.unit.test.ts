import { describe, expect, it, vi } from "vitest";
import { PrismaAuditLogRepository } from "../prisma.audit-log.repository.ts";

describe("audit entity history", () => {
  it("scopes every argument match to the project and action family, newest first", async () => {
    const entries = [
      {
        id: "audit-1",
        userId: null,
        action: "agents.copy",
        createdAt: new Date(0),
        args: { newAgentId: "agent-1" },
      },
    ];
    const findMany = vi.fn(async () => entries);
    const repository = PrismaAuditLogRepository.create({
      prisma: { auditLog: { create: vi.fn(), findMany } } as never,
    });

    await expect(
      repository.findEntityHistory({
        projectId: "project-1",
        actionPrefix: "agents.",
        entityId: "agent-1",
        argumentNames: ["id", "agentId", "newAgentId"],
        limit: 100,
      }),
    ).resolves.toEqual(entries);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        action: { startsWith: "agents." },
        OR: [
          { args: { path: ["id"], equals: "agent-1" } },
          { args: { path: ["agentId"], equals: "agent-1" } },
          { args: { path: ["newAgentId"], equals: "agent-1" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, userId: true, action: true, createdAt: true, args: true },
    });
  });
});
