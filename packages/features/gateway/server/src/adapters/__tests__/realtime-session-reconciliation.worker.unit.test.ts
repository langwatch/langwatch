import { describe, expect, it, vi } from "vitest";
import { FeatureRuntimeBuilder, ResourceScope } from "@langwatch/runtime-composition";
import {
  GatewayRealtimeSessionReconciliationWorker,
  createGatewayRealtimeSessionReconciliationFeature,
  realtimeSessionReconciliationConfig,
  type ElevenLabsConversationReader,
  type GatewayRealtimeSessionReconciliationInfrastructure,
  type RealtimeSessionReconciliationRepository,
} from "../realtime-session-reconciliation.adapter";

const session = {
  id: "session-1",
  projectId: "project-1",
  organizationId: "organization-1",
  virtualKeyId: "key-1",
  modelProviderId: "provider-1",
  vendor: "elevenlabs",
  model: "eleven_multilingual_v2",
  traceId: null,
  requestedModel: null,
  mintedAt: new Date("2026-08-25T11:55:00.000Z"),
  vendorConversationId: "conversation-1",
};

function buildWorker(options?: {
  conversation?: ElevenLabsConversationReader;
  sessions?: (typeof session)[];
}) {
  const repository: RealtimeSessionReconciliationRepository = {
    expireStaleSessions: vi.fn().mockResolvedValue(2),
    listOpenElevenLabsSessions: vi.fn().mockResolvedValue(options?.sessions ?? [session]),
    releaseMissingVendorConversation: vi.fn().mockResolvedValue(void 0),
    confirmSession: vi.fn().mockResolvedValue(void 0),
  };
  const conversations: ElevenLabsConversationReader = options?.conversation ?? {
    readConversation: vi.fn().mockResolvedValue({
      report: { status: "done", metadata: { call_duration_secs: 4.2 } },
      notFound: false,
    }),
  };
  const worker = GatewayRealtimeSessionReconciliationWorker.create({
    repository,
    credentials: {
      getApiCredential: vi.fn().mockResolvedValue({
        apiKey: "key",
        baseUrl: "https://api.elevenlabs.io",
      }),
    },
    conversations,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    config: realtimeSessionReconciliationConfig,
    clock: { now: () => new Date() },
  });

  return { worker, repository, conversations };
}

describe("GatewayRealtimeSessionReconciliationWorker", () => {
  it("expires stale sessions, reads eligible sessions exactly, and confirms rounded duration", async () => {
    const { worker, repository, conversations } = buildWorker();
    const now = new Date("2026-08-25T12:00:00.000Z");

    await expect(worker.poll(now)).resolves.toEqual({
      examined: 1,
      confirmed: 1,
      expired: 2,
    });
    expect(repository.listOpenElevenLabsSessions).toHaveBeenCalledWith({
      mintedBefore: new Date("2026-08-25T11:58:00.000Z"),
      limit: 25,
    });
    expect(conversations.readConversation).toHaveBeenCalledWith({
      apiKey: "key",
      baseUrl: "https://api.elevenlabs.io",
      conversationId: "conversation-1",
      timeoutMs: 10_000,
    });
    expect(repository.confirmSession).toHaveBeenCalledWith({
      session,
      audioMs: 4_000,
      vendorCostRaw: { call_duration_secs: 4.2 },
      durationMs: 4_000,
      reason: "reconciled by poll",
    });
  });

  it("releases a minted but unused credential when the vendor reports no conversation", async () => {
    const { worker, repository } = buildWorker({
      conversation: { readConversation: vi.fn().mockResolvedValue({ notFound: true }) },
    });

    await expect(worker.poll()).resolves.toMatchObject({ confirmed: 0 });
    expect(repository.releaseMissingVendorConversation).toHaveBeenCalledWith({
      sessionId: "session-1",
      projectId: "project-1",
      reason:
        "the vendor has no conversation for this session, so the credential was never used",
    });
  });

  it("leaves a terminal conversation open when its duration is unusable", async () => {
    const { worker, repository } = buildWorker({
      conversation: {
        readConversation: vi.fn().mockResolvedValue({
          report: { status: "done", metadata: { call_duration_secs: 0 } },
          notFound: false,
        }),
      },
    });

    await expect(worker.poll()).resolves.toMatchObject({ confirmed: 0 });
    expect(repository.confirmSession).not.toHaveBeenCalled();
    expect(repository.releaseMissingVendorConversation).not.toHaveBeenCalled();
  });

  it("does not schedule a timer until the worker feature is built", async () => {
    const { repository, conversations } = buildWorker();
    const resources = new ResourceScope();
    const feature = createGatewayRealtimeSessionReconciliationFeature();
    const credentials = {
      getApiCredential: vi.fn().mockResolvedValue(null),
    };

    expect(repository.expireStaleSessions).not.toHaveBeenCalled();
    const infrastructure: GatewayRealtimeSessionReconciliationInfrastructure = {
      repository,
      credentials,
      conversations,
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      config: realtimeSessionReconciliationConfig,
      clock: { now: () => new Date() },
    };
    await FeatureRuntimeBuilder.create({
      infrastructure,
      resources,
    }).build({ features: [feature], target: "worker" });
    await resources.close();
  });
});
