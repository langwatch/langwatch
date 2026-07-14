import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import {
  parseConversationTurnKey,
  type LangyConversationTurnData,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/projections/langyConversationTurn.foldProjection";
import { LANGY_TURN_TOOL_CALL_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import { langyPlanItemSchema } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import {
  langyJsonValueSchema,
  langyMessagePartSchema,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/shared";

const messagePartsSchema = z.array(langyMessagePartSchema);
const planSchema = z.array(langyPlanItemSchema);
const toolCallsSchema = z.array(
  z.record(z.string(), langyJsonValueSchema).and(
    z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      command: z.string().optional(),
      input: langyJsonValueSchema.optional(),
      status: z.union([
        z.literal(LANGY_TURN_TOOL_CALL_STATUS.INITIATED),
        z.literal(LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED),
        z.literal(LANGY_TURN_TOOL_CALL_STATUS.FAILED),
      ]),
      durationMs: z.number().optional(),
      errorText: z.string().optional(),
    }),
  ),
);

type Row = Prisma.LangyConversationTurnProjectionGetPayload<object>;

type ConversationTurnProjectionPrismaClient = {
  langyConversationTurnProjection: {
    findUnique(
      args: Prisma.LangyConversationTurnProjectionFindUniqueArgs,
    ): Promise<Row | null>;
    upsert(
      args: Prisma.LangyConversationTurnProjectionUpsertArgs,
    ): Promise<Row>;
  };
};

function fromRow(row: Row): StoredProjection<LangyConversationTurnData> {
  const {
    id: _id,
    projectId: _projectId,
    OccurredAt,
    AcceptedAt,
    LastEventId,
    ProjectionVersion,
    QuestionParts,
    AnswerParts,
    ToolCalls,
    Plan,
    ...state
  } = row;
  return {
    state: {
      ...state,
      QuestionParts: messagePartsSchema.parse(QuestionParts),
      AnswerParts: messagePartsSchema.parse(AnswerParts),
      ToolCalls: toolCallsSchema.parse(ToolCalls),
      Plan: Plan === null ? null : planSchema.parse(Plan),
      LastEventOccurredAt: OccurredAt,
    },
    cursor: { acceptedAt: AcceptedAt, eventId: LastEventId },
    occurredAt: OccurredAt,
    createdAt: state.CreatedAt,
    updatedAt: state.UpdatedAt,
    version: ProjectionVersion,
  };
}

/** Postgres row I/O for the type-aware turn projection. */
export class PrismaLangyConversationTurnProjectionRepository implements StateProjectionStore<LangyConversationTurnData> {
  constructor(
    private readonly prisma: ConversationTurnProjectionPrismaClient,
  ) {}

  async load(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<LangyConversationTurnData> | null> {
    const projectId = String(context.tenantId);
    const { conversationId: ConversationId, turnId: TurnId } =
      parseConversationTurnKey(key);
    const row = await this.prisma.langyConversationTurnProjection.findUnique({
      where: {
        // Keep the tenant predicate explicit for the Prisma tenancy guard;
        // the compound unique remains the database lookup key.
        projectId,
        projectId_ConversationId_TurnId: {
          projectId,
          ConversationId,
          TurnId,
        },
      },
    });
    return row ? fromRow(row) : null;
  }

  async store(
    projection: StoredProjection<LangyConversationTurnData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const key = context.key ?? context.aggregateId;
    const { conversationId: ConversationId, turnId: TurnId } =
      parseConversationTurnKey(key);
    const {
      LastEventOccurredAt: _checkpoint,
      QuestionParts,
      AnswerParts,
      ToolCalls,
      Plan,
      ...state
    } = projection.state;
    const data = {
      ...state,
      ConversationId,
      TurnId,
      QuestionParts,
      AnswerParts,
      ToolCalls,
      Plan: Plan === null ? Prisma.DbNull : Plan,
      CreatedAt: projection.createdAt,
      UpdatedAt: projection.updatedAt,
      OccurredAt: projection.occurredAt,
      AcceptedAt: projection.cursor.acceptedAt,
      LastEventId: projection.cursor.eventId,
      ProjectionVersion: projection.version,
    } satisfies Omit<
      Prisma.LangyConversationTurnProjectionUncheckedCreateInput,
      "id" | "projectId"
    >;

    await this.prisma.langyConversationTurnProjection.upsert({
      where: {
        projectId,
        projectId_ConversationId_TurnId: {
          projectId,
          ConversationId,
          TurnId,
        },
      },
      create: { projectId, ...data },
      update: data,
    });
  }
}
