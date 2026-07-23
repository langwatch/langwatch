import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaLangyConversationRepository } from "../langy-conversation.prisma.repository";

function makeRepository() {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    langyConversationProjection: { findMany },
  } as unknown as PrismaClient;
  return {
    findMany,
    repository: new PrismaLangyConversationRepository(prisma),
  };
}

describe("PrismaLangyConversationRepository.findAllForUser", () => {
  it("keeps project/user visibility predicates on server-side title search", async () => {
    const { findMany, repository } = makeRepository();

    await repository.findAllForUser({
      projectId: "project-a",
      userId: "user-a",
      limit: 31,
      query: "latency",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-a",
        ArchivedAt: null,
        OR: [{ UserId: "user-a" }, { IsShared: true }],
        Title: { contains: "latency", mode: "insensitive" },
      },
      orderBy: [
        { LastActivityAt: { sort: "desc", nulls: "last" } },
        { ConversationId: "desc" },
      ],
      take: 31,
    });
  });

  it("applies the stable activity/id cursor after the visibility boundary", async () => {
    const { findMany, repository } = makeRepository();

    await repository.findAllForUser({
      projectId: "project-a",
      userId: "user-a",
      limit: 31,
      cursor: { lastActivityAtMs: 1_700_000_000_000, id: "conv-20" },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-a",
          OR: [{ UserId: "user-a" }, { IsShared: true }],
          AND: [
            {
              OR: [
                { LastActivityAt: { lt: 1_700_000_000_000 } },
                {
                  LastActivityAt: 1_700_000_000_000,
                  ConversationId: { lt: "conv-20" },
                },
                { LastActivityAt: null },
              ],
            },
          ],
        }),
      }),
    );
  });

  it("continues deterministically within the null-activity tail", async () => {
    const { findMany, repository } = makeRepository();

    await repository.findAllForUser({
      projectId: "project-a",
      userId: "user-a",
      limit: 31,
      cursor: { lastActivityAtMs: null, id: "conv-10" },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              LastActivityAt: null,
              ConversationId: { lt: "conv-10" },
            },
          ],
        }),
      }),
    );
  });
});
