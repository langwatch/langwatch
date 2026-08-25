import { describe, expect, it, vi } from "vitest";
import {
  pollOpenRealtimeSessions,
  type RealtimeSessionPollerComposition,
} from "../gateway-realtime-session-reconciliation.adapter";

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

describe("gateway realtime-session reconciliation adapter", () => {
  it("binds the app session operations and leaves an unreadable session open", async () => {
    const database = {
      listOpenElevenLabsSessions: vi.fn().mockResolvedValue([session]),
    };
    const sessions = {
      expireStaleSessions: vi.fn().mockResolvedValue(3),
      releaseRealtimeSession: vi.fn().mockResolvedValue(true),
      closeAndConfirmRealtimeSession: vi.fn().mockResolvedValue(void 0),
    };
    const composition: RealtimeSessionPollerComposition = {
      database,
      sessions,
      credentials: { getApiCredential: vi.fn().mockResolvedValue(null) },
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      config: {
        tickIntervalMs: 60_000,
        pollAfterMs: 120_000,
        maxSessionsPerTick: 25,
        vendorCallTimeoutMs: 10_000,
      },
      clock: { now: () => new Date("2026-08-25T12:00:00.000Z") },
    };

    await expect(pollOpenRealtimeSessions(composition)).resolves.toEqual({
      examined: 1,
      confirmed: 0,
      expired: 3,
    });
    expect(sessions.expireStaleSessions).toHaveBeenCalledWith({
      now: new Date("2026-08-25T12:00:00.000Z"),
    });
    expect(database.listOpenElevenLabsSessions).toHaveBeenCalledWith({
      mintedBefore: new Date("2026-08-25T11:58:00.000Z"),
      limit: 25,
    });
    expect(sessions.closeAndConfirmRealtimeSession).not.toHaveBeenCalled();
    expect(sessions.releaseRealtimeSession).not.toHaveBeenCalled();
  });
});
