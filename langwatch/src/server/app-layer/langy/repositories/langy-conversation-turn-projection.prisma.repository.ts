import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import {
  langyMessagePartSchema,
  langyPlanItemSchema,
  langyTurnToolCallSchema,
  parseConversationTurnKey,
  type LangyConversationTurnData,
} from "@langwatch/langy";
import {
  LANGY_CONVERSATION_TURN_STATUS,
  type LangyConversationTurnStatus,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";

/**
 * The status values this column accepts, derived from the ONE definition rather
 * than restated here.
 *
 * `status` is TEXT in the database — see the schema comment — so this parse is
 * what the Postgres enum used to do. It is deliberately at the write boundary
 * and not in the fold: the fold is already typed, and a guard that only repeats
 * a type it trusts catches nothing. What this catches is the case the type
 * cannot see — a projection replayed from an event written by a newer version
 * of the fold, carrying a status this deployment has never heard of. Failing
 * the write is right there: a silently stored unknown status would be read back
 * as one, and every consumer would have to guess.
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
