/**
 * @vitest-environment node
 *
 * A command that runs on the developer's machine for longer than the turn
 * stall window, against the real liveness subscriber and a real Redis.
 *
 * A local call writes nothing on the turn while it runs, so a command that
 * took four minutes used to end with the subscriber failing the turn and the
 * developer losing the answer. The worker's long-poll is what keeps the turn
 * alive now, and this is the test that a call held past the stall window is
 * still a live turn.
 *
 * @see specs/langy/langy-local-control.feature
 */

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_STATUS,
} from "@langwatch/langy";
import {
  type RedisConnection,
  RedisConnectionService,
} from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LANGY_LIVENESS } from "~/server/app-layer/langy/streaming/langy.streaming.constants";
import {
  createLangyTokenBuffer,
  type LangyTokenBuffer,
} from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import { createAgentTurnLivenessSubscriber } from "~/server/app-layer/langy/subscribers/agent-turn-liveness.subscriber";
import {
  type AgentStateStore,
  createMemoryStateStore,
} from "~/server/connected-agents/state-store";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { LocalCallDispatcher } from "../call.dispatcher";
import { CALL_POLL_HOLD_MS } from "../constants";
import { LocalWorkspacePresence } from "../presence";

/** How long the subscriber lets a turn go quiet before it ends it. */
const STALL_WINDOW_MS = LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 3;

const projectId = "project_keepalive";
const context: EventSubscriberContext = {
  tenantId: "ignored_context_project",
  aggregateId: "ignored_context_conversation",
};

let connection: RedisConnection;
let buffer: LangyTokenBuffer;
let store: AgentStateStore;
let now = 1_752_600_100_000;

const startedAt = (): number => now;

function workspace(conversationId: string) {
  return {
    conversationId,
    projectId,
    userId: "user_1",
    requestId: "lcr_1",
    instanceId: "lci_1",
    hostname: "rogerio-mbp",
    connectedAt: now,
    lastSeenAt: now,
    workspace: { root: "/Users/dev/acme-app", name: "acme-app", os: "darwin" },
  };
}

/** The event that arms the check, and the record the check reads. */
function livenessEvent(
  conversationId: string,
  turnId: string,
  acceptedAt: number,
): LangyConversationProcessingEvent {
  return {
    id: `evt_${turnId}`,
    aggregateId: conversationId,
    aggregateType: "langy_conversation",
    tenantId: projectId,
    createdAt: acceptedAt,
    occurredAt: acceptedAt,
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
    data: { conversationId, turnId },
  } as LangyConversationProcessingEvent;
}

function subscriberOver({
  conversationId,
  turnId,
  acceptedAt,
}: {
  conversationId: string;
  turnId: string;
  acceptedAt: number;
}) {
  const failTurn = vi.fn().mockResolvedValue(undefined);
  const subscriber = createAgentTurnLivenessSubscriber({
    buffer,
    conversations: {
      read: async () => ({
        cursor: { acceptedAt, eventId: `evt_${turnId}` },
        status: LANGY_CONVERSATION_STATUS.RUNNING,
        currentTurnId: turnId,
        lastActivityAtMs: acceptedAt,
      }),
    },
    failTurn: { failTurn },
    worker: { dispatch: vi.fn().mockResolvedValue("accepted") },
    handoffStore: { read: async () => null },
    clock: () => now,
  });
  return { subscriber, failTurn };
}

/**
 * The worker's side of a call that has not answered yet: one poll request per
 * hold, for as long as the test says.
 */
async function pollFor({
  dispatcher,
  callId,
  forMs,
}: {
  dispatcher: LocalCallDispatcher;
  callId: string;
  forMs: number;
}): Promise<void> {
  const until = now + forMs;
  while (now < until) {
    await dispatcher.poll({ callId, holdMs: 0 });
    now += CALL_POLL_HOLD_MS;
  }
}

beforeAll(() => {
  connection = new RedisConnectionService().connect({
    url: process.env.REDIS_URL,
    clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
    dbIndex: process.env.REDIS_DB_INDEX,
  })!;
  if (!connection) throw new Error("This test needs a real Redis");
  buffer = createLangyTokenBuffer({ redis: connection });
  store = createMemoryStateStore({ now: () => now });
});

afterAll(async () => {
  await store?.close();
  await connection?.quit();
});

describe("given a command running on the developer's machine", () => {
  describe("when it takes longer than the turn stall window", () => {
    /** @scenario "A long command keeps its turn alive" */
    it("keeps the turn live and says on the panel what is running", async () => {
      const conversationId = "conv_alive";
      const turnId = "turn_alive";
      const acceptedAt = startedAt();
      const presence = new LocalWorkspacePresence({ store, now: () => now });
      await presence.register(workspace(conversationId));
      const dispatcher = new LocalCallDispatcher({
        store,
        presence,
        buffer,
        now: () => now,
        offlineWaitMs: 0,
        pollIntervalMs: 1,
      });
      const call = await dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: {
          tool: "local_bash",
          params: { command: "uv run pytest -q", timeout: 900 },
        },
        timeoutMs: 900_000,
      });

      await pollFor({
        dispatcher,
        callId: call.callId,
        forMs: STALL_WINDOW_MS * 2,
      });

      const { subscriber, failTurn } = subscriberOver({
        conversationId,
        turnId,
        acceptedAt,
      });
      const outcome = await subscriber
        .handle(livenessEvent(conversationId, turnId, acceptedAt), context)
        .then(() => null)
        .catch((error: unknown) => error);

      // A live turn is re-checked, never ended.
      expect(outcome).toBeInstanceOf(DispatchError);
      expect((outcome as DispatchError).retryable).toBe(true);
      expect(failTurn).not.toHaveBeenCalled();

      const tail = await buffer.readTail({ conversationId, turnId });
      const statuses = tail.reads
        .map((read) => read.entry)
        .filter((entry) => entry.type === "status")
        .map((entry) => (entry as { status: string }).status);
      expect(statuses[0]).toBe("Running on rogerio-mbp: uv run pytest -q");
    });
  });

  describe("when nothing is polling for its result any more", () => {
    /** @scenario "A long command keeps its turn alive" */
    it("ends the turn, so a dead worker is still caught", async () => {
      const conversationId = "conv_gone";
      const turnId = "turn_gone";
      const acceptedAt = startedAt();
      const presence = new LocalWorkspacePresence({ store, now: () => now });
      await presence.register(workspace(conversationId));
      const dispatcher = new LocalCallDispatcher({
        store,
        presence,
        now: () => now,
        offlineWaitMs: 0,
        pollIntervalMs: 1,
      });
      await dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_bash", params: { command: "uv run pytest -q" } },
        timeoutMs: 900_000,
      });
      now += STALL_WINDOW_MS * 2;

      const { subscriber, failTurn } = subscriberOver({
        conversationId,
        turnId,
        acceptedAt,
      });
      await subscriber.handle(
        livenessEvent(conversationId, turnId, acceptedAt),
        context,
      );

      expect(failTurn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, conversationId, turnId }),
      );
    });
  });
});
