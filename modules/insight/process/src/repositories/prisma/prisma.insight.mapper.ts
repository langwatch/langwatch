import { type InsightEntry, insightToneSchema } from "@langwatch/insight-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";

export type InsightRow = Prisma.InsightProjectionGetPayload<object>;
export type InsightReaderRow = Prisma.InsightReaderProjectionGetPayload<object>;

/** The tone column is TEXT, so the read narrows it back; an unknown tone refuses loudly. */
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
    source:
      insight.sourceConversationId !== null && insight.sourceMessageId !== null
        ? { conversationId: insight.sourceConversationId, messageId: insight.sourceMessageId }
        : null,
    filedByUserId: insight.filedByUserId,
    filedAt: insight.filedAt,
    renewedAt: insight.renewedAt,
    seenAt: reader?.seenAt ?? null,
    archivedAt: reader?.archivedAt ?? null,
    keptAt: reader?.keptAt ?? null,
  };
}
