import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { LangyDatabase } from "../langy-database.mapper.ts";
import { PrismaLangyConversationRepository } from "../prisma.langy-conversation.repository.ts";

function makeRepository() {
  const findFirst = vi.fn().mockResolvedValue(null);
  const prisma = createApiFixture<LangyDatabase>({
    langyTurnRequest: createApiFixture<LangyDatabase["langyTurnRequest"]>({ findFirst }),
  });
  return { findFirst, repository: PrismaLangyConversationRepository.create(prisma) };
}

describe("PrismaLangyConversationRepository.hasAdmittedTurn", () => {
  /** @scenario "A read in the dispatch window waits for the projection row" */
  it("reads the turn receipt for the project, conversation and user", async () => {
    const { findFirst, repository } = makeRepository();
    findFirst.mockResolvedValueOnce({ id: "receipt-1" });

    const admitted = await repository.hasAdmittedTurn({
      projectId: "project-a",
      conversationId: "conv-a",
      userId: "user-a",
    });

    expect(admitted).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { projectId: "project-a", conversationId: "conv-a", userId: "user-a" },
      select: { id: true },
    });
  });

  it("is false when no receipt exists", async () => {
    const { repository } = makeRepository();

    expect(
      await repository.hasAdmittedTurn({
        projectId: "project-a",
        conversationId: "conv-a",
        userId: "user-a",
      }),
    ).toBe(false);
  });
});
