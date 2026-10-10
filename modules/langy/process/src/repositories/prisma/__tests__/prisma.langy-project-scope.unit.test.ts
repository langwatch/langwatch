import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { LangyDatabase } from "../langy-database.mapper.ts";
import { PrismaLangyConversationRepository } from "../prisma.langy-conversation.repository.ts";
import { PrismaLangyMessageRepository } from "../prisma.langy-message.repository.ts";

const PROJECT_ID = "project-a";

function makeDatabase() {
  const conversation = {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([]),
  };
  const turn = { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) };
  const message = { findMany: vi.fn().mockResolvedValue([]) };
  const request = { findFirst: vi.fn().mockResolvedValue(null) };
  const database = createApiFixture<LangyDatabase>({
    langyConversationProjection:
      createApiFixture<LangyDatabase["langyConversationProjection"]>(conversation),
    langyConversationTurnProjection:
      createApiFixture<LangyDatabase["langyConversationTurnProjection"]>(turn),
    langyMessageProjection: createApiFixture<LangyDatabase["langyMessageProjection"]>(message),
    langyTurnRequest: createApiFixture<LangyDatabase["langyTurnRequest"]>(request),
  });
  return { database, conversation, turn, message, request };
}

describe("Langy Postgres reads", () => {
  /** @scenario "Every conversation read is scoped to the project" */
  it("filters every conversation and message read on the project", async () => {
    const { database, conversation, turn, message, request } = makeDatabase();
    const conversations = PrismaLangyConversationRepository.create(database);
    const messages = PrismaLangyMessageRepository.create(database);
    const owner = { projectId: PROJECT_ID, userId: "user-a" };

    await conversations.findAllForUser({ ...owner, limit: 10 });
    await conversations.findActiveOwnedIds(owner);
    await conversations.findOwnership({ ...owner, id: "conv-a" });
    await conversations.getVisibleById({ ...owner, id: "conv-a" }).catch(() => undefined);
    await conversations
      .getResumeState({ projectId: PROJECT_ID, conversationId: "conv-a" })
      .catch(() => undefined);
    await conversations.hasAdmittedTurn({ ...owner, conversationId: "conv-a" });
    await conversations.turnExists({
      projectId: PROJECT_ID,
      conversationId: "conv-a",
      turnId: "turn-a",
    });
    await messages.findAllByConversation({ projectId: PROJECT_ID, conversationId: "conv-a" });

    const filters = [
      ...conversation.findMany.mock.calls,
      ...conversation.findFirst.mock.calls,
      ...conversation.findUnique.mock.calls,
      ...turn.findFirst.mock.calls,
      ...message.findMany.mock.calls,
      ...request.findFirst.mock.calls,
    ].map(([args]) => args.where);

    expect(filters).toHaveLength(8);
    for (const where of filters) expect(where).toMatchObject({ projectId: PROJECT_ID });
  });

  describe("given a usage count over several projects", () => {
    it("filters every counting query on exactly those projects", async () => {
      const { database, conversation, turn } = makeDatabase();

      await PrismaLangyConversationRepository.create(database).countUsage({
        projectIds: [PROJECT_ID],
      });

      const scope = { projectId: { in: [PROJECT_ID] } };
      expect(turn.count).toHaveBeenCalledWith({ where: scope });
      expect(conversation.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: scope }));
      expect(turn.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: scope }));
    });
  });

  /** @scenario "Restoring a conversation returns its messages in order" */
  it("reads a conversation's messages in send order with role and flattened parts", async () => {
    const { database, message } = makeDatabase();
    message.findMany.mockResolvedValueOnce([
      {
        MessageId: "m1",
        Role: "user",
        Parts: [{ type: "text", text: "hello" }],
        CreatedAt: 1_000,
      },
      {
        MessageId: "m2",
        Role: "assistant",
        Parts: [{ type: "text", text: "hi there" }],
        CreatedAt: 2_000,
      },
    ]);

    const rows = await PrismaLangyMessageRepository.create(database).findAllByConversation({
      projectId: PROJECT_ID,
      conversationId: "conv-a",
    });

    expect(message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ CreatedAt: "asc" }, { MessageId: "asc" }] }),
    );
    expect(rows.map((row) => [row.id, row.role])).toEqual([
      ["m1", "user"],
      ["m2", "assistant"],
    ]);
  });
});
