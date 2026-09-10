import { EventEmitter } from "node:events";
import type { LangyConversationCommands, LangyTurnTechnicalMembers } from "@langwatch/langy-server";
import { LangyApp } from "../langy.app.ts";
import { describe, expect, it, vi } from "vitest";

const CONVERSATION = {
  projectId: "project_1",
  conversationId: "conversation_1",
  userId: "user_1",
};

describe("LangyApp", () => {
  it("calls the matching flat service methods through the real feature factory", async () => {
    const app = createApp();
    const getPage = vi.spyOn(app.langyService, "getPage").mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const getEventsAfter = vi.spyOn(app.langyService, "getEventsAfter").mockResolvedValue({
      events: [],
      cursor: { acceptedAt: 0, eventId: "" },
      truncated: false,
    });

    await app.listPage({ projectId: "project_1", userId: "user_1", limit: 10 });
    await app.eventsAfter({ ...CONVERSATION, after: { acceptedAt: 0, eventId: "" } });

    expect(getPage).toHaveBeenCalledOnce();
    expect(getEventsAfter).toHaveBeenCalledOnce();
  });

  it("keeps one service instance behind the application", () => {
    const app = createApp();
    expect(app.langyService).toBe(app.langyService);
  });
});

function createApp(): LangyApp {
  const commands = {
    createConversation: vi.fn(),
    forkConversation: vi.fn(),
    recordMessage: vi.fn(),
    importMessage: vi.fn(),
    acceptAgentTurn: vi.fn(),
    initiateToolCall: vi.fn(),
    succeedToolCall: vi.fn(),
    failToolCall: vi.fn(),
    updatePlan: vi.fn(),
    failAgentResponse: vi.fn(),
    recordAgentResponse: vi.fn(),
    archiveConversation: vi.fn(),
    updateConversationMetadata: vi.fn(),
    recordTurnHandoff: vi.fn(),
    consumeTurnHandoff: vi.fn(),
    generateConversationTitle: vi.fn(),
    requestLocalControl: vi.fn(),
    connectLocalWorkspace: vi.fn(),
    disconnectLocalWorkspace: vi.fn(),
    changeLocalPolicy: vi.fn(),
    startUserWait: vi.fn(),
    endUserWait: vi.fn(),
  } satisfies LangyConversationCommands;
  const turns: LangyTurnTechnicalMembers = {
    models: { resolve: vi.fn() },
    worker: null,
    tokenBuffer: null,
    accessStore: null,
    handoffStore: null,
    permits: { reserve: vi.fn(), release: vi.fn(), check: vi.fn() },
    perDayPrCap: 0,
    sessionKeys: { mint: vi.fn(), revoke: vi.fn() },
    context: { tryRender: vi.fn(() => null) },
    uiActionSurface: { resolve: vi.fn(async () => true) },
    metrics: { count: vi.fn() },
  };
  return LangyApp.create({
    dependencies: {},
    members: {
      database: undefined!,
      commands,
      turns,
      credentials: {
        sessionKeys: { mint: vi.fn(), revokeManaged: vi.fn() },
        virtualKeys: { provision: vi.fn() },
        github: { enabled: false, mintTurnToken: vi.fn() },
        runtime: {
          workerCallbackUrl: "https://langwatch.test/callback",
          workerGatewayBaseUrl: "https://langwatch.test/gateway",
          mirrorProjectId: undefined,
        },
      },
      redis: null,
      broadcast: {
        getTenantEmitter: () => new EventEmitter(),
        cleanupTenantEmitter: () => void 0,
      },
      feedbackPromptRedis: null,
    },
    config: { agentUrl: undefined, internalSecret: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
  });
}
