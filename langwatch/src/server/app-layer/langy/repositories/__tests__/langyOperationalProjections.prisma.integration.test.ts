import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";

import { LangyConversationNotFoundError } from "~/server/app-layer/langy/errors";
import { LangyMessageService } from "~/server/app-layer/langy/langy-message.service";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { Event } from "~/server/event-sourcing/domain/types";
import { MapProjectionExecutor } from "~/server/event-sourcing/projections/mapProjectionExecutor";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import { StateProjectionExecutor } from "~/server/event-sourcing/projections/stateProjectionExecutor";
import {
  LangyAgentRespondedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationStateFoldProjection,
  LangyConversationTurnFoldProjection,
  LangyMessageOperationalMapProjection,
  LangyPlanUpdatedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  makeConversationTurnKey,
} from "@langwatch/langy";
import { PrismaLangyConversationProjectionRepository } from "../langy-conversation-projection.prisma.repository";
import { PrismaLangyConversationTurnProjectionRepository } from "../langy-conversation-turn-projection.prisma.repository";
import { PrismaLangyConversationRepository } from "../langy-conversation.prisma.repository";
import { PrismaLangyMessageProjectionRepository } from "../langy-message-projection.prisma.repository";
import { PrismaLangyMessageRepository } from "../langy-message.prisma.repository";

const namespace = `langy-operational-${nanoid(10)}`;
const projectIds = [`${namespace}-project-a`, `${namespace}-project-b`];
const conversationId = `${namespace}-conversation`;
const messageId = `${namespace}-message`;
const turnId = `${namespace}-turn`;
const ownerA = `${namespace}-owner-a`;
const ownerB = `${namespace}-owner-b`;
const otherUser = `${namespace}-other-user`;

const stateExecutor = new StateProjectionExecutor();
const mapExecutor = new MapProjectionExecutor();

const conversationProjectionStore =
  new PrismaLangyConversationProjectionRepository(prisma);
const turnProjectionStore = new PrismaLangyConversationTurnProjectionRepository(
  prisma,
);
const messageProjectionStore = new PrismaLangyMessageProjectionRepository(
  prisma,
);
const conversationReadRepository = new PrismaLangyConversationRepository(
  prisma,
);
const messageReadRepository = new PrismaLangyMessageRepository(prisma);
const messageService = new LangyMessageService(
  messageReadRepository,
  conversationReadRepository,
);

const conversationProjection = new LangyConversationStateFoldProjection({
  store: conversationProjectionStore,
});
const turnProjection = new LangyConversationTurnFoldProjection({
  store: turnProjectionStore,
});
const messageProjection = new LangyMessageOperationalMapProjection({
  store: messageProjectionStore,
});

function context(projectId: string, key?: string): ProjectionStoreContext {
  return {
    aggregateId: conversationId,
    tenantId: createTenantId(projectId),
    ...(key ? { key } : {}),
  };
}

function eventBase({
  projectId,
  id,
  acceptedAt,
  occurredAt = acceptedAt,
}: {
  projectId: string;
  id: string;
  acceptedAt: number;
  occurredAt?: number;
}) {
  return {
    id: `${namespace}-${id}`,
    aggregateId: conversationId,
    aggregateType: "langy_conversation" as const,
    tenantId: createTenantId(projectId),
    createdAt: acceptedAt,
    occurredAt,
  };
}

function continuedEvent({
  projectId,
  owner,
  text,
  id,
  acceptedAt,
}: {
  projectId: string;
  owner: string;
  text: string;
  id: string;
  acceptedAt: number;
}) {
  return LangyMessageRecordedEventSchema.parse({
    ...eventBase({ projectId, id, acceptedAt }),
    type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED,
    data: {
      conversationId,
      userId: owner,
      messageId,
      role: "user",
      title: text,
      parts: [
        {
          type: "text",
          text,
          metadata: { filters: ["production", null], retries: 2 },
        },
      ],
    },
  });
}

async function projectConversationAndMessage(
  event: ReturnType<typeof continuedEvent>,
): Promise<void> {
  const eventContext = context(String(event.tenantId));
  await stateExecutor.execute({
    projection: conversationProjection,
    events: [event],
    context: eventContext,
  });
  await mapExecutor.execute(messageProjection, event, eventContext);
}

afterEach(async () => {
  const where = { projectId: { in: projectIds } };
  await prisma.langyMessageProjection.deleteMany({ where });
  await prisma.langyConversationTurnProjection.deleteMany({ where });
  await prisma.langyConversationProjection.deleteMany({ where });
});

describe("Langy operational projections with Postgres", () => {
  it("persists a state fold and message map idempotently on retry", async () => {
    const event = continuedEvent({
      projectId: projectIds[0]!,
      owner: ownerA,
      text: "Show me the slow production traces",
      id: "continued-a",
      acceptedAt: 1_000,
    });

    await projectConversationAndMessage(event);
    await projectConversationAndMessage(event);

    const conversation = await conversationProjectionStore.load(
      conversationId,
      context(projectIds[0]!),
    );
    const messages = await messageService.getAllByConversation({
      conversationId,
      projectId: projectIds[0]!,
      userId: ownerA,
    });

    expect(conversation).toEqual(
      expect.objectContaining({
        cursor: { acceptedAt: 1_000, eventId: event.id },
        occurredAt: 1_000,
        createdAt: 1_000,
        updatedAt: 1_000,
        state: expect.objectContaining({
          ConversationId: conversationId,
          UserId: ownerA,
          MessageCount: 1,
          LastEventOccurredAt: 1_000,
        }),
      }),
    );
    expect(messages).toEqual([
      expect.objectContaining({
        id: messageId,
        role: "user",
        parts: event.data.parts,
        createdAt: new Date(1_000),
      }),
    ]);
    expect(
      await prisma.langyMessageProjection.count({
        where: { projectId: projectIds[0]!, ConversationId: conversationId },
      }),
    ).toBe(1);
  });

  it("isolates the same conversation and message ids by project and user", async () => {
    const eventA = continuedEvent({
      projectId: projectIds[0]!,
      owner: ownerA,
      text: "Project A private message",
      id: "continued-project-a",
      acceptedAt: 2_000,
    });
    const eventB = continuedEvent({
      projectId: projectIds[1]!,
      owner: ownerB,
      text: "Project B private message",
      id: "continued-project-b",
      acceptedAt: 2_100,
    });
    await projectConversationAndMessage(eventA);
    await projectConversationAndMessage(eventB);

    await expect(
      messageService.getAllByConversation({
        conversationId,
        projectId: projectIds[0]!,
        userId: otherUser,
      }),
    ).rejects.toBeInstanceOf(LangyConversationNotFoundError);

    expect(
      await messageService.getAllByConversation({
        conversationId,
        projectId: projectIds[0]!,
        userId: ownerA,
      }),
    ).toEqual([expect.objectContaining({ parts: eventA.data.parts })]);
    expect(
      await messageService.getAllByConversation({
        conversationId,
        projectId: projectIds[1]!,
        userId: ownerB,
      }),
    ).toEqual([expect.objectContaining({ parts: eventB.data.parts })]);

    // findOwnership uses Prisma's compound unique selector. This assertion is
    // deliberately against the real tenant middleware: the selector must also
    // carry a top-level projectId or the middleware rejects it before Postgres.
    await expect(
      conversationReadRepository.findOwnership({
        id: conversationId,
        projectId: projectIds[0]!,
        userId: ownerA,
      }),
    ).resolves.toBe("owned");
    await expect(
      conversationReadRepository.findOwnership({
        id: conversationId,
        projectId: projectIds[0]!,
        userId: otherUser,
      }),
    ).resolves.toBe("other");
    await expect(
      conversationReadRepository.findOwnership({
        id: conversationId,
        projectId: `${namespace}-missing-project`,
        userId: ownerA,
      }),
    ).resolves.toBe("missing");

    const shared = LangyConversationMetadataUpdatedEventSchema.parse({
      ...eventBase({
        projectId: projectIds[0]!,
        id: "shared-project-a",
        acceptedAt: 2_200,
      }),
      type: LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
      data: { conversationId, isShared: true, sharedById: ownerA },
    });
    await stateExecutor.execute({
      projection: conversationProjection,
      events: [shared],
      context: context(projectIds[0]!),
    });

    expect(
      await messageService.getAllByConversation({
        conversationId,
        projectId: projectIds[0]!,
        userId: otherUser,
      }),
    ).toEqual([expect.objectContaining({ parts: eventA.data.parts })]);
    expect(
      await conversationReadRepository.findAllForUser({
        projectId: projectIds[0]!,
        userId: otherUser,
        limit: 10,
      }),
    ).toEqual([
      expect.objectContaining({ id: conversationId, userId: ownerA }),
    ]);
  });

  it("round-trips a complete turn document and its canonical cursor", async () => {
    const projectId = projectIds[0]!;
    const key = makeConversationTurnKey(conversationId, turnId);
    const start = LangyAgentTurnAcceptedEventSchema.parse({
      ...eventBase({ projectId, id: "turn-started", acceptedAt: 3_000 }),
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
      data: {
        conversationId,
        turnId,
        questionParts: [
          {
            type: "text",
            text: "Investigate latency",
            metadata: { percentiles: [50, 95, 99] },
          },
        ],
      },
    });
    const toolStarted = LangyToolCallInitiatedEventSchema.parse({
      ...eventBase({ projectId, id: "tool-started", acceptedAt: 3_100 }),
      type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED,
      data: {
        conversationId,
        turnId,
        toolCallId: `${namespace}-tool-call`,
        toolName: "query_traces",
        input: { limit: 10, filters: ["slow", null] },
      },
    });
    const toolSucceeded = LangyToolCallSucceededEventSchema.parse({
      ...eventBase({ projectId, id: "tool-succeeded", acceptedAt: 3_200 }),
      type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
      data: {
        ...toolStarted.data,
        durationMs: 42,
      },
    });
    const plan = LangyPlanUpdatedEventSchema.parse({
      ...eventBase({ projectId, id: "plan-updated", acceptedAt: 3_300 }),
      type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED,
      data: {
        conversationId,
        turnId,
        items: [
          {
            content: "Inspect production traces",
            status: "completed",
            metadata: { source: "agent" },
          },
        ],
      },
    });
    const responded = LangyAgentRespondedEventSchema.parse({
      ...eventBase({ projectId, id: "responded", acceptedAt: 3_400 }),
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
      data: {
        conversationId,
        turnId,
        messageId: `${namespace}-answer`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "The p99 regression comes from checkout.",
            metadata: { traceIds: ["trace-a", "trace-b"] },
          },
        ],
        outcome: "completed",
      },
    });

    // The executor establishes canonical accepted order even when the delivery
    // batch arrives shuffled.
    await stateExecutor.execute({
      projection: turnProjection,
      events: [responded, plan, start, toolSucceeded, toolStarted],
      context: context(projectId, key),
    });

    const stored = await turnProjectionStore.load(key, context(projectId, key));
    expect(stored).toEqual(
      expect.objectContaining({
        cursor: { acceptedAt: 3_400, eventId: responded.id },
        occurredAt: 3_400,
        createdAt: 3_000,
        updatedAt: 3_400,
        state: expect.objectContaining({
          ConversationId: conversationId,
          TurnId: turnId,
          Status: "completed",
          QuestionParts: start.data.questionParts,
          AnswerParts: responded.data.parts,
          ToolCalls: [
            expect.objectContaining({
              toolCallId: toolStarted.data.toolCallId,
              toolName: "query_traces",
              input: toolStarted.data.input,
              status: "succeeded",
              durationMs: 42,
            }),
          ],
          Plan: plan.data.items,
          LastEventOccurredAt: 3_400,
        }),
      }),
    );

    await stateExecutor.execute({
      projection: turnProjection,
      events: [responded] as Event[],
      context: context(projectId, key),
    });
    expect(
      await prisma.langyConversationTurnProjection.count({
        where: { projectId, ConversationId: conversationId, TurnId: turnId },
      }),
    ).toBe(1);
  });
});
