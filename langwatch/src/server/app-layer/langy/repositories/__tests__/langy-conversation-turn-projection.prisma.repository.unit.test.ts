import {
  type LangyConversationTurnProjection,
  Prisma,
} from "@prisma/client";
import { LANGY_CONVERSATION_TURN_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import { PrismaLangyConversationTurnProjectionRepository } from "../langy-conversation-turn-projection.prisma.repository";

type Row = LangyConversationTurnProjection;
type Client = ConstructorParameters<
  typeof PrismaLangyConversationTurnProjectionRepository
>[0];
type FindUnique = Client["langyConversationTurnProjection"]["findUnique"];
type Upsert = Client["langyConversationTurnProjection"]["upsert"];

const questionParts = [
  {
    type: "text",
    text: "How are the traces doing?",
    metadata: { retries: 1, flags: [true, null] },
  },
];
const answerParts = [{ type: "text", text: "They look healthy." }];
const toolCalls = [
  {
    toolCallId: "call-1",
    toolName: "query_traces",
    input: { limit: 10, filters: ["production", null] },
    status: "succeeded",
    durationMs: 42,
  },
];
const plan = [{ content: "Inspect traces", status: "completed" }];

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "turn-row-1",
    projectId: "project-1",
    ConversationId: "conversation-1",
    TurnId: "turn-1",
    Status: LANGY_CONVERSATION_TURN_STATUS.COMPLETED,
    QuestionParts: questionParts,
    AnswerParts: answerParts,
    ToolCalls: toolCalls,
    Plan: plan,
    Error: null,
    StartedAt: 110,
    EndedAt: 150,
    CreatedAt: 110,
    UpdatedAt: 150,
    OccurredAt: 150,
    AcceptedAt: 200,
    LastEventId: "event-b",
    ProjectionVersion: "v1",
    ...overrides,
  };
}

function setup(result: Row) {
  const findUnique = vi.fn<FindUnique>(async () => result);
  const upsert = vi.fn<Upsert>(async () => result);
  const client = {
    langyConversationTurnProjection: { findUnique, upsert },
  } satisfies Client;
  return {
    findUnique,
    repository: new PrismaLangyConversationTurnProjectionRepository(client),
    upsert,
  };
}

function context(projectId = "project-1"): ProjectionStoreContext {
  return {
    aggregateId: "conversation-1",
    key: "conversation-1:turn-1",
    tenantId: createTenantId(projectId),
  };
}

describe("PrismaLangyConversationTurnProjectionRepository", () => {
  it("validates and round-trips nested JSON without casts", async () => {
    const { repository, upsert } = setup(row());
    const projection = await repository.load(
      "conversation-1:turn-1",
      context(),
    );

    expect(projection?.state).toEqual(
      expect.objectContaining({
        QuestionParts: questionParts,
        AnswerParts: answerParts,
        ToolCalls: toolCalls,
        Plan: plan,
        LastEventOccurredAt: 150,
      }),
    );

    await repository.store(projection!, context());

    expect(upsert).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        projectId_ConversationId_TurnId: {
          projectId: "project-1",
          ConversationId: "conversation-1",
          TurnId: "turn-1",
        },
      },
      create: expect.objectContaining({
        projectId: "project-1",
        QuestionParts: questionParts,
        AnswerParts: answerParts,
        ToolCalls: toolCalls,
        Plan: plan,
        AcceptedAt: 200,
        LastEventId: "event-b",
      }),
      update: expect.objectContaining({
        QuestionParts: questionParts,
        AnswerParts: answerParts,
        ToolCalls: toolCalls,
        Plan: plan,
      }),
    });
  });

  it("represents an absent plan as database NULL on write", async () => {
    const { repository, upsert } = setup(row({ Plan: null }));
    const projection = await repository.load(
      "conversation-1:turn-1",
      context(),
    );

    await repository.store(projection!, context());

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ Plan: Prisma.DbNull }),
        update: expect.objectContaining({ Plan: Prisma.DbNull }),
      }),
    );
  });

  it("rejects malformed JSON read from Postgres", async () => {
    const { repository } = setup(
      row({
        ToolCalls: [
          {
            toolCallId: "call-1",
            toolName: "query_traces",
            status: "not-a-real-status",
          },
        ],
      }),
    );

    await expect(
      repository.load("conversation-1:turn-1", context()),
    ).rejects.toThrow();
  });

  it("uses project, conversation, and turn in the persistence key", async () => {
    const { findUnique, repository } = setup(row());

    await repository.load("conversation-1:turn-1", context("project-other"));

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        projectId: "project-other",
        projectId_ConversationId_TurnId: {
          projectId: "project-other",
          ConversationId: "conversation-1",
          TurnId: "turn-1",
        },
      },
    });
  });
});
