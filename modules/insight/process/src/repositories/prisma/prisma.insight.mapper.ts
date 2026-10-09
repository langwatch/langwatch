import {
  type InsightBoard,
  type InsightEntry,
  insightFiledViaSchema,
  type InsightReplay,
  insightReplaySchema,
  insightToneSchema,
} from "@langwatch/insight-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";

export type InsightRow = Prisma.InsightProjectionGetPayload<object>;
export type InsightReaderRow = Prisma.InsightReaderProjectionGetPayload<object>;

/** The pointer's four columns: a board with its name, and a widget only with both of its own. */
function boardField(insight: InsightRow): Pick<InsightEntry, "board"> {
  if (insight.boardId === null || insight.boardName === null) return { board: null };
  const widget =
    insight.widgetId !== null && insight.widgetName !== null
      ? { id: insight.widgetId, name: insight.widgetName }
      : null;
  return { board: { id: insight.boardId, name: insight.boardName, widget } };
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The window's columns and the JSON beside them; no window unless all three columns are set. */
function replayField(insight: InsightRow): Pick<InsightEntry, "replay"> {
  const { replayStart, replayEnd, replayGranularitySeconds } = insight;
  if (replayStart === null || replayEnd === null || replayGranularitySeconds === null) {
    return { replay: null };
  }
  const replay = insightReplaySchema.parse({
    period: null,
    parameters: {},
    ...(isJsonObject(insight.replayContext) ? insight.replayContext : {}),
    start: replayStart,
    end: replayEnd,
    granularitySeconds: replayGranularitySeconds,
  });
  return { replay };
}

type BoardColumns = Pick<InsightRow, "boardId" | "boardName" | "widgetId" | "widgetName">;

/** The pointer as the four columns that hold it. */
export function boardColumns(board: InsightBoard | null): BoardColumns {
  return {
    boardId: board?.id ?? null,
    boardName: board?.name ?? null,
    widgetId: board?.widget?.id ?? null,
    widgetName: board?.widget?.name ?? null,
  };
}

type ReplayColumns = Pick<InsightRow, "replayStart" | "replayEnd" | "replayGranularitySeconds"> & {
  replayContext: Pick<InsightReplay, "period" | "parameters"> | null;
};

/** The window as its three columns, with the values in force as the JSON beside them. */
export function replayColumns(replay: InsightReplay | null): ReplayColumns {
  return {
    replayStart: replay?.start ?? null,
    replayEnd: replay?.end ?? null,
    replayGranularitySeconds: replay?.granularitySeconds ?? null,
    replayContext: replay ? { period: replay.period, parameters: replay.parameters } : null,
  };
}

/** `tone` and `filedVia` are TEXT, so the read narrows them back; an unknown one refuses loudly. */
export function insightEntryFromRows({
  insight,
  reader,
}: {
  insight: InsightRow;
  reader: InsightReaderRow | undefined;
}): InsightEntry {
  return {
    id: insight.id,
    title: insight.title,
    body: insight.body,
    tone: insightToneSchema.parse(insight.tone),
    topic: insight.topic,
    validDays: insight.validDays,
    lwql: insight.lwql,
    ...replayField(insight),
    source:
      insight.sourceConversationId !== null && insight.sourceMessageId !== null
        ? { conversationId: insight.sourceConversationId, messageId: insight.sourceMessageId }
        : null,
    ...boardField(insight),
    filedVia: insightFiledViaSchema.parse(insight.filedVia),
    filedByUserId: insight.filedByUserId,
    filedAt: insight.filedAt,
    renewedAt: insight.renewedAt,
    seenAt: reader?.seenAt ?? null,
    archivedAt: reader?.archivedAt ?? null,
    keptAt: reader?.keptAt ?? null,
  };
}
