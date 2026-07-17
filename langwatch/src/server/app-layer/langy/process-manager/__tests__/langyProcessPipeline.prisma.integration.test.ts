import { nanoid } from "nanoid";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  OutboxDispatcherService,
  PrismaProcessStore,
  ProcessManagerService,
  type ProcessRef,
} from "~/server/event-sourcing/process-manager";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

import { langyConversationProcessDefinition } from "../langyConversationProcess.definition";
import {
  LANGY_CONVERSATION_PROCESS_NAME,
  type LangyConversationProcessState,
} from "../langyConversationProcess.types";
import {
  createLangyIntentHandlers,
  createStubLangyEffectPorts,
} from "../langyEffectPorts";
import { createLangyProcessSubscriber } from "../langyProcessSubscriber";
import {
  agentRespondedEvent,
  agentTurnAcceptedEvent,
  conversationStartedEvent,
  SENTINELS,
  T0,
} from "./helpers/langyEventFixtures";

const namespace = `langy-process-${nanoid(10)}`;
const projectId = `${namespace}-project`;
const conversationId = `${namespace}-conversation`;
const turnId = `${namespace}-turn`;
const userId = `${namespace}-user`;
const PROCESS_NOW = 1;

const store = new PrismaProcessStore(prisma);
const ref: ProcessRef = {
  processName: LANGY_CONVERSATION_PROCESS_NAME,
  projectId,
  processKey: conversationId,
};
const subscriberContext: EventSubscriberContext = {
  tenantId: createTenantId(projectId),
  aggregateId: conversationId,
};

function lifecycle() {
  const started = conversationStartedEvent({
    id: `${namespace}-conversation-started`,
    occurredAt: T0,
  });
  const turnAccepted = agentTurnAcceptedEvent({
    id: `${namespace}-response-started`,
    occurredAt: T0 + 1_000,
    turnId,
  });
  const responded = agentRespondedEvent({
    id: `${namespace}-responded`,
    occurredAt: T0 + 2_000,
    turnId,
  });
  return [
    {
      ...started,
      aggregateId: conversationId,
      tenantId: createTenantId(projectId),
      data: {
        ...started.data,
        conversationId,
        userId,
      },
    },
    {
      ...turnAccepted,
      aggregateId: conversationId,
      tenantId: createTenantId(projectId),
      data: { ...turnAccepted.data, conversationId, turnId },
    },
    {
      ...responded,
      aggregateId: conversationId,
      tenantId: createTenantId(projectId),
      data: { ...responded.data, conversationId, turnId },
    },
  ] as const;
}

afterEach(async () => {
  const where = { processName: LANGY_CONVERSATION_PROCESS_NAME, projectId };
  await prisma.processManagerOutbox.deleteMany({ where });
  await prisma.processManagerInbox.deleteMany({ where });
  await prisma.processManagerInstance.deleteMany({ where });
});

describe("Langy process subscriber and outbox with Postgres", () => {
  it("commits each event once and dispatches its durable intents through typed stubs", async () => {
    const notifyOutbox = vi.fn();
    const processManager = new ProcessManagerService({
      definition: langyConversationProcessDefinition,
      store,
    });
    const subscriber = createLangyProcessSubscriber({
      processManager,
      notifyOutbox,
      clock: () => PROCESS_NOW,
    });
    const events = lifecycle();

    for (const event of events) {
      await subscriber.handle(event, subscriberContext);
    }
    // The queue is at-least-once. A complete redelivery must change neither
    // process state nor the durable intent set.
    for (const event of events) {
      await subscriber.handle(event, subscriberContext);
    }

    const instance = await store.findByRef<LangyConversationProcessState>({
      ref,
    });
    const messages = await store.findMessagesByRef({ ref });
    expect(instance).toEqual(
      expect.objectContaining({
        revision: 3,
        state: expect.objectContaining({
          currentTurnId: null,
          turnStatus: "completed",
          autoTitleRequested: true,
        }),
      }),
    );
    expect(messages.map((message) => message.messageKey).sort()).toEqual([
      `dispatch:${turnId}`,
      `title:${turnId}`,
    ]);
    expect(notifyOutbox).toHaveBeenCalledTimes(3);

    const persisted = JSON.stringify({ instance, messages });
    expect(persisted).not.toContain(SENTINELS.runToken);
    expect(persisted).not.toContain(SENTINELS.questionText);
    expect(persisted).not.toContain(SENTINELS.answerText);

    const { ports, calls } = createStubLangyEffectPorts();
    const dispatcher = new OutboxDispatcherService({
      store,
      handlers: createLangyIntentHandlers({ ports }),
    });
    const report = await dispatcher.runOnce({ now: PROCESS_NOW, limit: 10 });

    expect(report.dispatched.sort()).toEqual([
      `dispatch:${turnId}`,
      `title:${turnId}`,
    ]);
    expect(report.retried).toEqual([]);
    expect(report.dead).toEqual([]);
    expect(calls.dispatchedTurns).toEqual([
      {
        projectId,
        conversationId,
        turnId,
        resumeFromTurnId: null,
      },
    ]);
    expect(calls.titleRequests).toEqual([
      { projectId, conversationId, turnId },
    ]);

    expect(
      await prisma.processManagerOutbox.count({
        where: {
          processName: LANGY_CONVERSATION_PROCESS_NAME,
          projectId,
          dispatchedAt: { not: null },
        },
      }),
    ).toBe(2);
  });
});
