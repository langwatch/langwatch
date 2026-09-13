import { EventEmitter } from "node:events";
import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { LangyRepositories } from "../../repositories/langy-repositories.registry.ts";
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

/** Records what a producer enqueued; a producer-only process starts no consumer. */
function recordingQueue() {
  const sent: Record<string, unknown>[] = [];
  const factory = (
    _definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>> => ({
    async send(payload) {
      sent.push(payload);
    },
    async sendBatch(payloads) {
      sent.push(...payloads);
    },
    async waitUntilReady() {},
    async close() {},
  });
  return { sent, factory };
}

/**
 * A real, minimal producer-only `EventSourcing`: no Redis, no ClickHouse, just
 * an in-memory queue recording what the langy conversation pipeline sends.
 * `EventSourcing` holds private state, so only a real instance satisfies its
 * type — the same construction the authz producer-registration suite uses.
 */
function producerEventing(): EventSourcing {
  const queue = recordingQueue();
  return new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: "langwatch-test" }),
    queueFactory: queue.factory,
    consumersEnabled: false,
    executionTarget: "api",
    processManagerMode: "producer-only",
  });
}

function fakePresence(): PresenceApi {
  return {
    isEnabledForProject: () => Promise.resolve(true),
    update: () => Promise.resolve(),
    leave: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    broadcastCursor: () => Promise.resolve(),
    events: async function* () {},
    cursors: async function* () {},
    getTenantEmitter: () => new EventEmitter(),
    cleanupTenantEmitter: () => void 0,
  };
}

function createApp(): LangyApp {
  return LangyApp.create({
    dependencies: { presence: fakePresence() },
    members: { prisma: undefined!, redis: null, eventing: producerEventing() },
    config: { agentUrl: undefined, internalSecret: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
    repositories: {} as LangyRepositories,
  });
}
