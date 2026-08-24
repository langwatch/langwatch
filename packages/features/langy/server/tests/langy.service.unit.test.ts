import { describe, expect, it, vi } from "vitest";
import { LangyService } from "../src/services/langy.service";
import {
  ConversationRepository,
  CredentialRepository,
  MessageRepository,
  RelayRepository,
  TurnRepository,
} from "../src/repositories/langy.repository";

const conversation = {
  id: "conversation_1",
  projectId: "project_1",
  userId: "user_1",
  title: null,
  isShared: false,
  status: "active",
  currentTurnId: null,
  lastError: null,
  lastModel: null,
  messageCount: 0,
  lastActivityAt: 0,
};

class Conversations extends ConversationRepository {
  readonly tryGet = vi.fn(
    async (): Promise<typeof conversation | null> => conversation,
  );
  list = vi.fn(async () => ({ items: [conversation], nextCursor: null }));
  create = vi.fn(async () => conversation);
  archive = vi.fn(async () => undefined);
}
class Turns extends TurnRepository {
  start = vi.fn(async () => ({ conversation, turnId: "turn_1" }));
  stop = vi.fn(async () => undefined);
}
class Messages extends MessageRepository {
  list = vi.fn(async () => []);
}
class Credentials extends CredentialRepository {
  resolve = vi.fn(async () => ({
    token: "token",
    expiresAt: 1,
    scope: "turn" as const,
  }));
  tryGetEgressAllowlist = vi.fn(async () => null);
  trySetEgressAllowlist = vi.fn(async () => null);
}
class Relay extends RelayRepository {
  publish = vi.fn(async () => undefined);
}

function service() {
  const repositories = {
    conversations: new Conversations(),
    turns: new Turns(),
    messages: new Messages(),
    credentials: new Credentials(),
    relay: new Relay(),
  };
  return { service: LangyService.create(repositories), repositories };
}

describe("LangyService", () => {
  it("leaves conversation identity and creation semantics with the repository", async () => {
    const { service: langy, repositories } = service();
    const input = { projectId: "project_1", userId: "user_1" };

    await langy.createConversation(input);

    expect(repositories.conversations.create).toHaveBeenCalledWith(input);
  });

  it("delegates a relay frame to the one relay repository", async () => {
    const { service: langy, repositories } = service();
    const frame = {
      conversationId: "conversation_1",
      turnId: "turn_1",
      type: "delta",
      payload: { text: "hi" },
    };
    await langy.relay(frame);
    expect(repositories.relay.publish).toHaveBeenCalledWith(frame);
  });

  it("turns repository absence into the contract error", async () => {
    const { service: langy, repositories } = service();
    repositories.conversations.tryGet.mockResolvedValueOnce(null);
    await expect(
      langy.getConversation({
        projectId: "project_1",
        userId: "user_1",
        conversationId: "missing",
      }),
    ).rejects.toMatchObject({ code: "langy_conversation_not_found" });
  });

  it("checks conversation visibility before reading messages", async () => {
    const { service: langy, repositories } = service();
    repositories.conversations.tryGet.mockResolvedValueOnce(null);

    await expect(
      langy.listMessages({
        projectId: "project_1",
        userId: "user_1",
        conversationId: "missing",
      }),
    ).rejects.toMatchObject({ code: "langy_conversation_not_found" });
    expect(repositories.messages.list).not.toHaveBeenCalled();
  });
});
