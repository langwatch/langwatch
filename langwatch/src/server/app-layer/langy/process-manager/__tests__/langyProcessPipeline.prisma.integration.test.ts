import { nanoid } from "nanoid";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  OutboxDispatcherService,
  PrismaProcessStore,
  type ProcessRef,
} from "~/server/event-sourcing/process-manager";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import {
  buildIntentHandlers,
  ProcessRuntime,
} from "~/server/event-sourcing/process-manager/processRuntime";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import { langyConversationProcess } from "../langyConversationProcess";
import {
  LANGY_CONVERSATION_PROCESS_NAME,
  type LangyConversationProcessState,
} from "../langyConversationProcess.types";
import {
  createStubLangyEffectPorts,
  type LangyEffectPorts,
} from "../langyEffectPorts";
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

function buildLangyManager(ports: LangyEffectPorts) {
  return buildProcessManager<LangyConversationProcessingEvent>({
    name: LANGY_CONVERSATION_PROCESS_NAME,
    applier: langyConversationProcess(ports),
  });
}

describe("Langy process manager and outbox with Postgres", () => {
  it("commits each event once and dispatches its durable intents through typed stubs", async () => {
    const { ports, calls } = createStubLangyEffectPorts();
    const definition = buildLangyManager(ports);
    // The real production path: ProcessRuntime generates the
    // `pm:langyConversation` subscriber from the pipeline declaration.
    const runtime = new ProcessRuntime({ store, consumersEnabled: false });
    const { subscribers } = runtime.registerPipeline<LangyConversationProcessingEvent>({
      pipelineName: "langy-conversation-processing",
      processManagers: new Map([[LANGY_CONVERSATION_PROCESS_NAME, definition]]),
    });
    const subscriber = subscribers[0];
    if (!subscriber) throw new Error("runtime generated no subscriber");
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
    // The builder qualifies every message key with the process key, so two
    // conversations can never collide on one turn id.
    expect(messages.map((message) => message.messageKey).sort()).toEqual([
      `process:${conversationId}:dispatch:${turnId}`,
      `process:${conversationId}:title:${turnId}`,
    ]);

    const persisted = JSON.stringify({ instance, messages });
    expect(persisted).not.toContain(SENTINELS.runToken);
    expect(persisted).not.toContain(SENTINELS.questionText);
    expect(persisted).not.toContain(SENTINELS.answerText);

    const dispatcher = new OutboxDispatcherService({
      store,
      // Generated from the declared intents, schema validation included.
      handlers: buildIntentHandlers(definition.config),
    });
    // The generated subscriber commits against real wall time, so the
    // dispatch window must be read against the same clock.
    const report = await dispatcher.runOnce({ now: Date.now() + 1, limit: 10 });

    expect(report.dispatched.sort()).toEqual([
      `process:${conversationId}:dispatch:${turnId}`,
      `process:${conversationId}:title:${turnId}`,
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
