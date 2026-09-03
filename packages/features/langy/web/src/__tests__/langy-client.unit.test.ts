import { describe, expect, it, vi } from "vitest";
import { LangyClient } from "../model/langy-client";

describe("LangyClient", () => {
  it("validates before delegating to the browser transport", async () => {
    const transport = {
      listConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
      getConversation: vi.fn(),
      startTurn: vi.fn(),
      listMessages: vi.fn(),
      resolveCredential: vi.fn(),
      stopTurn: vi.fn(),
      relay: vi.fn(),
    };
    const client = new LangyClient(transport);
    await client.listConversations({
      projectId: "project_1",
      userId: "user_1",
      limit: 1,
    });
    expect(transport.listConversations).toHaveBeenCalledWith({
      projectId: "project_1",
      userId: "user_1",
      limit: 1,
    });
    expect(() =>
      client.listConversations({ projectId: "", userId: "user_1", limit: 1 }),
    ).toThrow();
  });
});
