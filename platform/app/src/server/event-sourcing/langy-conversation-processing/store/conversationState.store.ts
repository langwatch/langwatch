import type { Prisma } from "@prisma/client";
import type { ReplaceStore, StateRead, StoreContext, StoredState } from "@langwatch/event-sourcing";
import { LANGY_CONVERSATION_STATUS, LANGY_TITLE_SOURCE } from "@langwatch/langy";
import {
  LANGY_CONVERSATION_SPINE_STATE_VERSION,
  type LangyConversationSpineState,
} from "../conversationState.fold";

/**
 * Writes the existing `LangyConversationProjection` Postgres table rather than
 * forking a parallel one for the same rebuildable projection.
 */

type Row = Prisma.LangyConversationProjectionGetPayload<object>;

type ConversationProjectionPrismaClient = {
  langyConversationProjection: {
    findUnique(
      args: Prisma.LangyConversationProjectionFindUniqueArgs,
    ): Promise<Row | null>;
    upsert(args: Prisma.LangyConversationProjectionUpsertArgs): Promise<Row>;
  };
};

const TITLE_SOURCES = new Set(Object.values(LANGY_TITLE_SOURCE));
const STATUSES = new Set(Object.values(LANGY_CONVERSATION_STATUS));

/**
 * Decodes a row into state, or reports why it could not (ADR-098 decision 6:
 * `undecodable` is never treated as `absent`). The version gate runs first —
 * a row written under a different projection version must never reach the
 * enum/shape checks below it, because those checks are only meaningful for
 * the CURRENT shape.
 */
function decodeRow(
  row: Row,
): { kind: "found"; state: LangyConversationSpineState } | { kind: "undecodable"; cause?: unknown } {
  if (row.projectionVersion !== LANGY_CONVERSATION_SPINE_STATE_VERSION) {
    return { kind: "undecodable" };
  }
  if (!TITLE_SOURCES.has(row.titleSource as never)) {
    return { kind: "undecodable", cause: `unknown titleSource "${row.titleSource}"` };
  }
  if (!STATUSES.has(row.status as never)) {
    return { kind: "undecodable", cause: `unknown status "${row.status}"` };
  }
  return {
    kind: "found",
    state: {
      ConversationId: row.conversationId,
      UserId: row.userId,
      Title: row.title,
      TitleSource: row.titleSource as never,
      Status: row.status,
      IsShared: row.isShared,
      SharedAt: row.sharedAt,
      SharedById: row.sharedById,
      MessageCount: row.messageCount,
      LastActivityAt: row.lastActivityAt,
      CurrentTurnId: row.currentTurnId,
      LastError: row.lastError,
      PendingHandoffToken: row.pendingHandoffToken,
      PendingHandoffTurnId: row.pendingHandoffTurnId,
      RunToken: row.runToken,
      ArchivedAt: row.archivedAt,
      LastEventId: row.lastEventId,
      AcceptedAt: row.acceptedAt,
    },
  };
}

export function createLangyConversationStateStore(deps: {
  readonly prisma: ConversationProjectionPrismaClient;
}): ReplaceStore<LangyConversationSpineState> {
  return {
    kind: "replace",

    async read(key: string, context: StoreContext): Promise<StateRead<LangyConversationSpineState>> {
      const projectId = context.tenantId;
      const row = await deps.prisma.langyConversationProjection.findUnique({
        where: {
          projectId,
          projectId_ConversationId: { projectId, ConversationId: key },
        },
      });
      if (!row) return { kind: "absent" };

      const decoded = decodeRow(row);
      if (decoded.kind === "undecodable") {
        return {
          kind: "undecodable",
          storedVersion: row.projectionVersion,
          cause: decoded.cause,
        };
      }
      return {
        kind: "found",
        stored: { state: decoded.state, version: row.projectionVersion },
      };
    },

    async write(
      key: string,
      stored: StoredState<LangyConversationSpineState>,
      context: StoreContext,
    ): Promise<void> {
      const projectId = context.tenantId;
      const now = Date.now();
      const { LastEventId, AcceptedAt, ...state } = stored.state;
      const data = {
        UserId: state.UserId,
        Title: state.Title,
        TitleSource: state.TitleSource,
        Status: state.Status,
        IsShared: state.IsShared,
        SharedAt: state.SharedAt,
        SharedById: state.SharedById,
        MessageCount: state.MessageCount,
        LastActivityAt: state.LastActivityAt,
        CurrentTurnId: state.CurrentTurnId,
        LastError: state.LastError,
        PendingHandoffToken: state.PendingHandoffToken,
        PendingHandoffTurnId: state.PendingHandoffTurnId,
        RunToken: state.RunToken,
        ArchivedAt: state.ArchivedAt,
        UpdatedAt: now,
        OccurredAt: now,
        AcceptedAt,
        LastEventId,
        ProjectionVersion: stored.version,
      };

      await deps.prisma.langyConversationProjection.upsert({
        where: {
          projectId,
          projectId_ConversationId: { projectId, ConversationId: key },
        },
        // CreatedAt is stamped ONLY on the create branch — the upsert's
        // update branch never touches it, which is what preserves true
        // first-write provenance without a read-before-write.
        create: { projectId, ConversationId: key, CreatedAt: now, ...data },
        update: data,
      });
    },
  };
}
