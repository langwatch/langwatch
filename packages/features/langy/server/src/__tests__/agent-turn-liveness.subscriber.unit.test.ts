import type { EventSubscriberContext } from "@langwatch/eventing";
import { createTenantId, DispatchError } from "@langwatch/eventing";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_STATUS,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";
import type { LangyTurnHandoff } from "@langwatch/langy-server";
import type { LangyConversationProcessingEvent } from "@langwatch/langy-server/event-sourcing/langy.events";
import { LANGY_LIVENESS } from "../streaming/langy-streaming.constants";

import {
  createAgentTurnLivenessSubscriber,
  LANGY_HEARTBEAT_GRACE_MS,
  type LangyConversationLivenessRecord,
} from "@langwatch/langy-server";

const NOW = 1_752_600_100_000;
const ACCEPTED_AT = NOW - LANGY_HEARTBEAT_GRACE_MS;
const context: EventSubscriberContext = {
  tenantId: "ignored_context_project",
  aggregateId: "ignored_context_conversation",
};

function makeEvent(
  overrides: Partial<LangyConversationProcessingEvent> = {},
): LangyConversationProcessingEvent {
  return {
    id: "evt_b",
    aggregateId: "conv_1",
    aggregateType: "langy_conversation",
    tenantId: "project_1",
    createdAt: ACCEPTED_AT,
    occurredAt: ACCEPTED_AT,
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
    data: { conversationId: "conv_1", turnId: "turn_1" },
    ...overrides,
  } as LangyConversationProcessingEvent;
}

function makeRecord(
  overrides: Partial<LangyConversationLivenessRecord> = {},
): LangyConversationLivenessRecord {
  return {
    cursor: { acceptedAt: ACCEPTED_AT, eventId: "evt_b" },
    status: LANGY_CONVERSATION_STATUS.RUNNING,
    currentTurnId: "turn_1",
    lastActivityAtMs: NOW - 1_000,
    ...overrides,
  };
}

function makeHandoff(overrides: Partial<LangyTurnHandoff> = {}): LangyTurnHandoff {
  return {
    projectId: "project_1",
    conversationId: "conv_1",
    turnId: "turn_1",
    actorUserId: "user_1",
    prompt: "prompt",
    system: "system",
    credentials: {
      llmVirtualKey: "vk",
      langwatchEndpoint: "https://langwatch.test",
      gatewayBaseUrl: "https://gateway.test/v1",
      organizationId: "org_1",
    },
    runToken: "run_token",
    permitReserved: false,
    ...overrides,
  };
}

function makeDeps(params?: {
  conversation?: LangyConversationLivenessRecord | null;
  liveness?: { present: boolean; stale: boolean; lastBeatAt: number | null };
  handoff?: LangyTurnHandoff | null;
}) {
  return {
    conversations: {
      read: vi.fn().mockResolvedValue(params?.conversation ?? makeRecord()),
    },
    buffer: {
      liveness: vi.fn().mockResolvedValue(
        params?.liveness ?? {
          present: false,
          stale: true,
          lastBeatAt: null,
        },
      ),
      appendStatus: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn().mockResolvedValue(undefined),
    },
    handoffStore: {
      read: vi.fn().mockResolvedValue(params?.handoff ?? null),
    },
    worker: { dispatch: vi.fn().mockResolvedValue("accepted") },
    failTurn: { failTurn: vi.fn().mockResolvedValue(undefined) },
    clock: () => NOW,
  };
}

describe("agent turn liveness subscriber", () => {
  it("configures one delayed, tenant-scoped timer per conversation turn", () => {
    const subscriber = createAgentTurnLivenessSubscriber(makeDeps());
    const event = makeEvent({
      tenantId: createTenantId("project_2"),
      aggregateId: "conv_2",
    });

    expect(subscriber.options?.delay).toBe(LANGY_HEARTBEAT_GRACE_MS);
    const deduplication = subscriber.options?.deduplication;
    expect(typeof deduplication).toBe("object");
    if (typeof deduplication === "object") {
      expect(deduplication.makeId(event)).toBe("langy-liveness:project_2:conv_2:turn_1");
      expect(deduplication.ttlMs).toBe(LANGY_HEARTBEAT_GRACE_MS * 2);
    }
  });

  it("uses a fresh Postgres read scoped by the committed tenant and aggregate", async () => {
    const deps = makeDeps({
      liveness: { present: true, stale: false, lastBeatAt: NOW },
    });
    const subscriber = createAgentTurnLivenessSubscriber(deps);
    const event = makeEvent({
      tenantId: createTenantId("project_2"),
      aggregateId: "conv_2",
    });

    await expect(subscriber.handle(event, context)).rejects.toBeInstanceOf(DispatchError);

    expect(deps.conversations.read).toHaveBeenCalledWith({
      projectId: "project_2",
      conversationId: "conv_2",
    });
    expect(deps.buffer.liveness).toHaveBeenCalledWith({
      conversationId: "conv_2",
      turnId: "turn_1",
      now: NOW,
      graceMs: LANGY_HEARTBEAT_GRACE_MS,
    });
  });

  it("retries before deciding when the fresh projection cursor is behind", async () => {
    const deps = makeDeps({
      conversation: makeRecord({
        cursor: { acceptedAt: ACCEPTED_AT, eventId: "evt_a" },
      }),
    });
    const subscriber = createAgentTurnLivenessSubscriber(deps);

    await expect(subscriber.handle(makeEvent(), context)).rejects.toThrow(
      "langyConversation has not projected event evt_b yet",
    );
    expect(deps.buffer.liveness).not.toHaveBeenCalled();
  });

  it("re-arms another check instead of going quiet when the heartbeat is healthy", async () => {
    const deps = makeDeps({
      liveness: { present: true, stale: false, lastBeatAt: NOW },
    });
    const subscriber = createAgentTurnLivenessSubscriber(deps);

    const error = await subscriber
      .handle(makeEvent(), context)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DispatchError);
    expect((error as DispatchError).retryable).toBe(true);
    expect((error as DispatchError).retryAfterMs).toBe(LANGY_HEARTBEAT_GRACE_MS);
    expect(deps.handoffStore.read).not.toHaveBeenCalled();
    expect(deps.worker.dispatch).not.toHaveBeenCalled();
    expect(deps.failTurn.failTurn).not.toHaveBeenCalled();
  });

  it.each([
    makeRecord({ status: LANGY_CONVERSATION_STATUS.IDLE, currentTurnId: null }),
    makeRecord({ currentTurnId: "turn_2" }),
  ])("does nothing for a terminal or superseded turn", async (conversation) => {
    const deps = makeDeps({ conversation });
    const subscriber = createAgentTurnLivenessSubscriber(deps);

    await subscriber.handle(makeEvent(), context);

    expect(deps.buffer.liveness).not.toHaveBeenCalled();
    expect(deps.worker.dispatch).not.toHaveBeenCalled();
    expect(deps.failTurn.failTurn).not.toHaveBeenCalled();
  });

  it("re-dispatches a recently stalled turn and throws for queue retry", async () => {
    const deps = makeDeps({ handoff: makeHandoff() });
    const subscriber = createAgentTurnLivenessSubscriber(deps);

    await expect(subscriber.handle(makeEvent(), context)).rejects.toBeInstanceOf(DispatchError);
    expect(deps.worker.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        conversationId: "conv_1",
        turnId: "turn_1",
        userId: "user_1",
      }),
    );
    expect(deps.buffer.appendStatus).toHaveBeenCalledOnce();
    expect(deps.failTurn.failTurn).not.toHaveBeenCalled();
  });

  it("fails a turn that stayed stale past the retry window", async () => {
    const deps = makeDeps({
      conversation: makeRecord({
        lastActivityAtMs: NOW - LANGY_HEARTBEAT_GRACE_MS * 3 - 1,
      }),
      handoff: makeHandoff(),
    });
    const subscriber = createAgentTurnLivenessSubscriber(deps);

    await subscriber.handle(makeEvent(), context);

    expect(deps.buffer.markError).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv_1", turnId: "turn_1" }),
    );
    expect(deps.failTurn.failTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        conversationId: "conv_1",
        turnId: "turn_1",
      }),
    );
    expect(deps.worker.dispatch).not.toHaveBeenCalled();
  });

  it("never dispatches a handoff from another tenant or aggregate", async () => {
    const deps = makeDeps({
      handoff: makeHandoff({ projectId: "project_other" }),
    });
    const subscriber = createAgentTurnLivenessSubscriber(deps);

    await expect(subscriber.handle(makeEvent(), context)).rejects.toBeInstanceOf(DispatchError);

    expect(deps.worker.dispatch).not.toHaveBeenCalled();
  });

  it("fails a stalled turn rather than dispatching a handoff from another tenant", async () => {
    const deps = makeDeps({
      conversation: makeRecord({
        lastActivityAtMs: NOW - LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 3 - 1,
      }),
      handoff: makeHandoff({ projectId: "project_other" }),
    });
    const subscriber = createAgentTurnLivenessSubscriber(deps);

    await subscriber.handle(makeEvent(), context);

    expect(deps.worker.dispatch).not.toHaveBeenCalled();
    expect(deps.failTurn.failTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        conversationId: "conv_1",
      }),
    );
  });

  describe("when the heartbeat lapsed and there is nothing to revive the turn with", () => {
    /** @scenario A turn still doing work is not failed because its heartbeat lapsed */
    it("leaves a turn that is still recording activity running, and re-arms", async () => {
      const deps = makeDeps({ handoff: null });
      const subscriber = createAgentTurnLivenessSubscriber(deps);

      const error = await subscriber
        .handle(makeEvent(), context)
        .then(() => null)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DispatchError);
      expect((error as DispatchError).retryable).toBe(true);
      expect((error as DispatchError).retryAfterMs).toBe(LANGY_LIVENESS.HEARTBEAT_GRACE_MS);
      expect(deps.failTurn.failTurn).not.toHaveBeenCalled();
      expect(deps.buffer.markError).not.toHaveBeenCalled();
      expect(deps.worker.dispatch).not.toHaveBeenCalled();
    });

    /** @scenario A turn that really stalled with nothing to revive it is failed */
    it("fails a turn that has recorded no activity past the stall window", async () => {
      const deps = makeDeps({
        conversation: makeRecord({
          lastActivityAtMs: NOW - LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 3 - 1,
        }),
        handoff: null,
      });
      const subscriber = createAgentTurnLivenessSubscriber(deps);

      await subscriber.handle(makeEvent(), context);

      expect(deps.worker.dispatch).not.toHaveBeenCalled();
      const [failure] = deps.failTurn.failTurn.mock.calls[0] ?? [];
      expect(JSON.parse((failure as { error: string }).error).code).toBe("langy_worker_stopped");
    });
  });
});
