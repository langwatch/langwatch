import {
  type AppendStore,
  type BatchContext,
  ConfigurationError,
  type ReplaceStore,
  type StateRead,
  type StoreContext,
  type StoredState,
} from "@langwatch/event-sourcing";
import {
  LANGY_CONVERSATION_STATUS,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TITLE_SOURCE,
  type LangyConversationTurnStatus,
  type LangyMessageProjectionRecord,
  type LangyTitleSource,
  langyMessagePartSchema,
  langyPlanItemSchema,
  langyTurnToolCallSchema,
  parseConversationTurnKey,
} from "@langwatch/langy";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  LANGY_CONVERSATION_SPINE_VERSION,
  LANGY_CONVERSATION_TURN_PROJECTION,
  LANGY_CONVERSATION_TURN_VERSION,
  type LangyConversationSpineState,
  type LangyConversationTurnState,
} from "./folds";

/**
 * Postgres is this pipeline's projection store: the conversation spine and the
 * turn document are read back by the product's own reads, which are relational.
 * Each store owns the three properties `clickhouseReplacing` centralises for
 * the ClickHouse folds — the version gate before decode, read-your-writes, and
 * a durable-first write — because no `postgresRow` factory exists yet.
 */

/** Enum columns are TEXT, so the boundary decides what a stored value means. */
const titleSourceSchema = z.enum(
  Object.values(LANGY_TITLE_SOURCE) as [
    LangyTitleSource,
    ...LangyTitleSource[],
  ],
);
const conversationStatusSchema = z.enum(
  Object.values(LANGY_CONVERSATION_STATUS) as [string, ...string[]],
);
const turnStatusSchema = z.enum(
  Object.values(LANGY_CONVERSATION_TURN_STATUS) as [
    LangyConversationTurnStatus,
    ...LangyConversationTurnStatus[],
  ],
);

const messagePartsSchema = z.array(langyMessagePartSchema);
const planSchema = z.array(langyPlanItemSchema);
const toolCallsSchema = z.array(langyTurnToolCallSchema);

type Decoded<State> =
  | { readonly kind: "found"; readonly state: State }
  | { readonly kind: "undecodable"; readonly cause: unknown };

/**
 * The version gate runs before any shape check: a row written under another
 * projection version must never reach checks that are only meaningful for the
 * current shape (ADR-098 decision 6 — `undecodable` is never `absent`).
 */
function gated<Row extends { ProjectionVersion: string }, State>(
  row: Row,
  version: string,
  decode: (row: Row) => State,
): Decoded<State> {
  if (row.ProjectionVersion !== version) {
    return { kind: "undecodable", cause: undefined };
  }
  try {
    return { kind: "found", state: decode(row) };
  } catch (error) {
    return { kind: "undecodable", cause: error };
  }
}

function toStateRead<State>(
  row: { ProjectionVersion: string } | null,
  decoded: Decoded<State> | null,
  version: string,
): StateRead<State> {
  if (row === null || decoded === null) return { kind: "absent" };
  return decoded.kind === "found"
    ? { kind: "found", stored: { state: decoded.state, version } }
    : {
        kind: "undecodable",
        storedVersion: row.ProjectionVersion,
        cause: decoded.cause,
      };
}

/** The three models this pipeline projects onto, and nothing else. */
export type LangyProjectionPrisma = ConversationPrismaClient &
  TurnPrismaClient &
  MessagePrismaClient;

type ConversationRow = Prisma.LangyConversationProjectionGetPayload<object>;

type ConversationPrismaClient = {
  langyConversationProjection: {
    findUnique(
      args: Prisma.LangyConversationProjectionFindUniqueArgs,
    ): Promise<ConversationRow | null>;
    upsert(
      args: Prisma.LangyConversationProjectionUpsertArgs,
    ): Promise<ConversationRow>;
  };
};

function decodeConversationRow(
  row: ConversationRow,
): LangyConversationSpineState {
  return {
    ConversationId: row.ConversationId,
    UserId: row.UserId,
    Title: row.Title,
    TitleSource: titleSourceSchema.parse(row.TitleSource),
    Status: conversationStatusSchema.parse(row.Status),
    IsShared: row.IsShared,
    SharedAt: row.SharedAt,
    SharedById: row.SharedById,
    MessageCount: row.MessageCount,
    LastActivityAt: row.LastActivityAt,
    CurrentTurnId: row.CurrentTurnId,
    LastError: row.LastError,
    PendingHandoffToken: row.PendingHandoffToken,
    PendingHandoffTurnId: row.PendingHandoffTurnId,
    RunToken: row.RunToken,
    ArchivedAt: row.ArchivedAt,
  };
}

export function createLangyConversationStateStore(deps: {
  readonly prisma: ConversationPrismaClient;
}): ReplaceStore<LangyConversationSpineState> {
  return {
    kind: "replace",

    async read(key, context: StoreContext) {
      const projectId = context.tenantId;
      const row = await deps.prisma.langyConversationProjection.findUnique({
        // The tenant predicate stays explicit for the Prisma tenancy guard; the
        // compound unique remains the lookup key.
        where: {
          projectId,
          projectId_ConversationId: { projectId, ConversationId: key },
        },
      });
      return toStateRead(
        row,
        row &&
          gated(row, LANGY_CONVERSATION_SPINE_VERSION, decodeConversationRow),
        LANGY_CONVERSATION_SPINE_VERSION,
      );
    },

    async write(
      key,
      stored: StoredState<LangyConversationSpineState>,
      context: StoreContext,
    ) {
      const projectId = context.tenantId;
      const now = Date.now();
      const state = stored.state;
      const data = {
        ...state,
        ConversationId: key,
        UpdatedAt: now,
        // Accept-time cursor placeholder: a `.withFold` handler sees no event
        // id or accept time, so these three columns cannot be computed here.
        // See this pipeline's conversion report.
        OccurredAt: state.LastActivityAt ?? now,
        AcceptedAt: now,
        LastEventId: "",
        ProjectionVersion: stored.version,
      } satisfies Omit<
        Prisma.LangyConversationProjectionUncheckedCreateInput,
        "id" | "projectId" | "CreatedAt"
      >;

      await deps.prisma.langyConversationProjection.upsert({
        where: {
          projectId,
          projectId_ConversationId: { projectId, ConversationId: key },
        },
        // CreatedAt is stamped only on create, so first-write provenance
        // survives without a read before the write.
        create: { projectId, CreatedAt: now, ...data },
        update: data,
      });
    },
  };
}

type TurnRow = Prisma.LangyConversationTurnProjectionGetPayload<object>;

type TurnPrismaClient = {
  langyConversationTurnProjection: {
    findUnique(
      args: Prisma.LangyConversationTurnProjectionFindUniqueArgs,
    ): Promise<TurnRow | null>;
    upsert(
      args: Prisma.LangyConversationTurnProjectionUpsertArgs,
    ): Promise<TurnRow>;
  };
};

/**
 * The turn document's row key is `makeConversationTurnKey`'s
 * `${conversationId}:${turnId}` — the turn is the aggregate, not the
 * conversation. A key carrying no turn component would key every turn of a
 * conversation onto `TurnId: ""`, each write overwriting the last, so it is
 * refused here rather than defaulted (`parseConversationTurnKey` is total by
 * design and cannot refuse it).
 */
function turnRowKey(key: string): {
  conversationId: string;
  turnId: string;
} {
  const parsed = parseConversationTurnKey(key);
  if (!parsed.conversationId || !parsed.turnId) {
    throw new ConfigurationError(
      `${LANGY_CONVERSATION_TURN_PROJECTION}'s row key must be "<conversationId>:<turnId>"`,
      { projection: LANGY_CONVERSATION_TURN_PROJECTION, key },
    );
  }
  return parsed;
}

function decodeTurnRow(row: TurnRow): LangyConversationTurnState {
  return {
    ConversationId: row.ConversationId,
    TurnId: row.TurnId,
    Status: turnStatusSchema.parse(row.Status),
    QuestionParts: messagePartsSchema.parse(row.QuestionParts),
    AnswerParts: messagePartsSchema.parse(row.AnswerParts),
    ToolCalls: toolCallsSchema.parse(row.ToolCalls),
    Plan: row.Plan === null ? null : planSchema.parse(row.Plan),
    Error: row.Error,
    StartedAt: row.StartedAt,
    EndedAt: row.EndedAt,
  };
}

export function createLangyConversationTurnStore(deps: {
  readonly prisma: TurnPrismaClient;
}): ReplaceStore<LangyConversationTurnState> {
  return {
    kind: "replace",

    async read(key, context: StoreContext) {
      const projectId = context.tenantId;
      const { conversationId, turnId } = turnRowKey(key);
      const row = await deps.prisma.langyConversationTurnProjection.findUnique({
        where: {
          projectId,
          projectId_ConversationId_TurnId: {
            projectId,
            ConversationId: conversationId,
            TurnId: turnId,
          },
        },
      });
      return toStateRead(
        row,
        row && gated(row, LANGY_CONVERSATION_TURN_VERSION, decodeTurnRow),
        LANGY_CONVERSATION_TURN_VERSION,
      );
    },

    async write(
      key,
      stored: StoredState<LangyConversationTurnState>,
      context: StoreContext,
    ) {
      const projectId = context.tenantId;
      const { conversationId, turnId } = turnRowKey(key);
      const now = Date.now();
      const { Plan, ...state } = stored.state;
      const data = {
        ...state,
        ConversationId: conversationId,
        TurnId: turnId,
        Plan: Plan === null ? Prisma.DbNull : Plan,
        UpdatedAt: now,
        // Same accept-time placeholder as the spine store — see there.
        OccurredAt: state.EndedAt ?? state.StartedAt ?? now,
        AcceptedAt: now,
        LastEventId: "",
        ProjectionVersion: stored.version,
      } satisfies Omit<
        Prisma.LangyConversationTurnProjectionUncheckedCreateInput,
        "id" | "projectId" | "CreatedAt"
      >;

      await deps.prisma.langyConversationTurnProjection.upsert({
        where: {
          projectId,
          projectId_ConversationId_TurnId: {
            projectId,
            ConversationId: conversationId,
            TurnId: turnId,
          },
        },
        create: { projectId, CreatedAt: now, ...data },
        update: data,
      });
    },
  };
}

type MessageRow = Prisma.LangyMessageProjectionGetPayload<object>;

type MessagePrismaClient = {
  langyMessageProjection: {
    upsert(args: Prisma.LangyMessageProjectionUpsertArgs): Promise<MessageRow>;
  };
};

/**
 * A message row is immutable once written, so a redelivery collapses onto its
 * own `(projectId, ConversationId, MessageId)` key rather than adding a row.
 */
export function createLangyMessageStore(deps: {
  readonly prisma: MessagePrismaClient;
}): AppendStore<LangyMessageProjectionRecord> {
  return {
    kind: "append",

    async writeBatch(
      records: readonly LangyMessageProjectionRecord[],
      context: BatchContext,
    ) {
      const projectId = context.tenantId;
      await Promise.all(
        records.map((record) =>
          deps.prisma.langyMessageProjection.upsert({
            where: {
              projectId,
              projectId_ConversationId_MessageId: {
                projectId,
                ConversationId: record.ConversationId,
                MessageId: record.MessageId,
              },
            },
            create: { projectId, ...record },
            update: record,
          }),
        ),
      );
    },
  };
}
