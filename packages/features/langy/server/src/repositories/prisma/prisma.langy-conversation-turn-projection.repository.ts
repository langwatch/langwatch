import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import {
  LANGY_CONVERSATION_TURN_STATUS,
  type LangyConversationTurnData,
  type LangyConversationTurnStatus,
  langyMessagePartSchema,
  langyPlanItemSchema,
  langyTurnToolCallSchema,
  parseConversationTurnKey,
} from "@langwatch/langy-contract";
import { z } from "zod";
import { Prisma } from "@langwatch/prisma-client/generated";
import type { LangyDatabase } from "./prisma.langy-database";

/**
 * `status` is TEXT in the database, so this parse stands in for the Postgres
 * enum. Deliberately at the write boundary, not the fold: catches a status a
 * newer fold version wrote that this deployment doesn't recognize.
 */
const turnStatusSchema = z.enum(
  // Cast to the UNION, not to `[string, ...string[]]`: the latter is enough for
  // `z.enum` to validate but makes `parse` return a plain string, which is
  // exactly the narrowing the read path needs back.
  Object.values(LANGY_CONVERSATION_TURN_STATUS) as [
    LangyConversationTurnStatus,
    ...LangyConversationTurnStatus[],
  ],
);

// Composed only through instanceof-safe combinators (z.array) — the record
// intersection itself lives in the package, next to the type it validates.
const messagePartsSchema = z.array(langyMessagePartSchema);
const planSchema = z.array(langyPlanItemSchema);
const toolCallsSchema = z.array(langyTurnToolCallSchema);

type Row = Prisma.LangyConversationTurnProjectionGetPayload<object>;

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
      // The column is TEXT now, so the row hands back a plain string and the
      // domain type wants the union. Parsing on the way OUT as well as in is
      // the point of choosing text: this is the boundary that decides what a
      // stored status means, and it refuses one this build cannot interpret
      // rather than passing it on as if it understood it.
      Status: turnStatusSchema.parse(state.Status),
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
  constructor(private readonly prisma: LangyDatabase) {}

  static create(database: LangyDatabase): PrismaLangyConversationTurnProjectionRepository {
    return new PrismaLangyConversationTurnProjectionRepository(database);
  }

  async tryLoad(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<LangyConversationTurnData> | null> {
    const projectId = String(context.tenantId);
    const { conversationId: ConversationId, turnId: TurnId } = parseConversationTurnKey(key);
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
    const { conversationId: ConversationId, turnId: TurnId } = parseConversationTurnKey(key);
    const {
      LastEventOccurredAt: _checkpoint,
      QuestionParts,
      AnswerParts,
      ToolCalls,
      Plan,
      ...state
    } = projection.state;
    // Parsed, not asserted: `state` comes off a replayed projection, so this is
    // the boundary where an unrecognised status must stop rather than land in a
    // column that will happily hold it.
    turnStatusSchema.parse(state.Status);
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
