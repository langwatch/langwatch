/**
 * @vitest-environment node
 * The memory tier's database rows answer the way the Postgres ones do: a
 * row a fold stored is the row a read answers with, and admission keeps one
 * active turn per conversation.
 */
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import type { LangyConversationStateData } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { MemoryLangyRepositories } from "../memory/memory.langy.repositories.ts";

function contextFor(conversationId: string, key?: string): ProjectionStoreContext {
  return {
    tenantId: createTenantId("proj_1"),
    aggregateId: conversationId,
    ...(key ? { key } : {}),
  };
}

function conversation(overrides: Partial<LangyConversationStateData>): LangyConversationStateData {
  return {
    ConversationId: "",
    UserId: "user_1",
    Title: null,
    TitleSource: "default" as LangyConversationStateData["TitleSource"],
    Status: "idle",
    IsShared: false,
    SharedAt: null,
    SharedById: null,
    MessageCount: 0,
    LastActivityAt: null,
    CurrentTurnId: null,
    LastError: null,
    LastModel: null,
    PendingHandoffToken: null,
    PendingHandoffTurnId: null,
    RunToken: null,
    ArchivedAt: null,
    CreatedAt: 1_000,
    UpdatedAt: 1_000,
    LastEventOccurredAt: 1_000,
    ...overrides,
  };
}

async function storeConversation(
  repositories: ReturnType<typeof MemoryLangyRepositories.create>,
  conversationId: string,
  state: Partial<LangyConversationStateData>,
): Promise<void> {
  await repositories.conversationState.store(
    {
      state: conversation(state),
      cursor: { acceptedAt: 1_000, eventId: `evt_${conversationId}` },
      occurredAt: 1_000,
      createdAt: 1_000,
      updatedAt: 1_000,
      version: "v1",
    },
    contextFor(conversationId),
  );
}

describe("given the memory tier's database rows", () => {
  describe("when a fold stores a conversation", () => {
    it("is the row the conversation reads answer with", async () => {
      const repositories = MemoryLangyRepositories.create();
      await storeConversation(repositories, "conv_a", { Title: "Alpha", LastActivityAt: 5 });
      await storeConversation(repositories, "conv_b", { Title: "Beta", LastActivityAt: 9 });
      await storeConversation(repositories, "conv_c", { UserId: "user_2" });

      const visible = await repositories.conversations.getVisibleById({
        id: "conv_a",
        projectId: "proj_1",
        userId: "user_1",
      });
      const listed = await repositories.conversations.findAllForUser({
        projectId: "proj_1",
        userId: "user_1",
        limit: 10,
      });

      expect(visible).toMatchObject({ id: "conv_a", title: "Alpha", lastActivityAtMs: 5 });
      expect(listed.map((row) => row.id)).toEqual(["conv_b", "conv_a"]);
      expect(
        await repositories.conversations.findOwnership({
          id: "conv_c",
          projectId: "proj_1",
          userId: "user_1",
        }),
      ).toBe("other");
    });
  });

  describe("when a send is admitted", () => {
    it("records the receipt and refuses a second turn on the conversation", async () => {
      const repositories = MemoryLangyRepositories.create();
      const send = {
        projectId: "proj_1",
        userId: "user_1",
        conversationId: "conv_a",
      };

      const first = await repositories.admission.claim({
        ...send,
        idempotencyKey: "idem_1",
        turnId: "turn_1",
      });
      const second = await repositories.admission.claim({
        ...send,
        idempotencyKey: "idem_2",
        turnId: "turn_2",
      });
      const reused = await repositories.admission.claim({
        ...send,
        idempotencyKey: "idem_1",
        turnId: "turn_other",
      });

      expect(first.kind).toBe("claimed");
      expect(second.kind).toBe("busy");
      expect(reused.kind).toBe("mismatch");
      expect(await repositories.conversations.hasAdmittedTurn(send)).toBe(true);
    });

    it("replays a committed send under the same key", async () => {
      const repositories = MemoryLangyRepositories.create();
      const send = {
        projectId: "proj_1",
        userId: "user_1",
        conversationId: "conv_a",
        idempotencyKey: "idem_1",
        turnId: "turn_1",
      };
      const claim = await repositories.admission.claim(send);
      if (claim.kind !== "claimed") throw new Error("expected a claim");
      await repositories.admission.commit({ ...send, claimToken: claim.claimToken });

      expect(await repositories.admission.claim(send)).toEqual({
        kind: "replay",
        conversationId: "conv_a",
        turnId: "turn_1",
      });
    });
  });

  describe("when the message map appends a message", () => {
    it("is read back in creation order", async () => {
      const repositories = MemoryLangyRepositories.create();
      const base = {
        ConversationId: "conv_a",
        Role: "user" as const,
        Parts: [{ type: "text" as const, text: "hello" }],
        SourceEventId: "evt_1",
        OccurredAt: 1,
        AcceptedAt: 1,
        UpdatedAt: 1,
      };
      await repositories.messageStorage.append(
        { ...base, MessageId: "msg_2", CreatedAt: 20 },
        contextFor("conv_a"),
      );
      await repositories.messageStorage.append(
        { ...base, MessageId: "msg_1", CreatedAt: 10 },
        contextFor("conv_a"),
      );

      const messages = await repositories.messages.findAllByConversation({
        conversationId: "conv_a",
        projectId: "proj_1",
      });

      expect(messages.map((message) => message.id)).toEqual(["msg_1", "msg_2"]);
    });
  });
});
