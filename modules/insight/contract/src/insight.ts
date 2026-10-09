import { z } from "zod";

/** Langy's verdict on the news, written out on the card rather than left to a colour. */
export const INSIGHT_TONES = ["bad", "watch", "good"] as const;
export const insightToneSchema = z.enum(INSIGHT_TONES);
export type InsightTone = z.infer<typeof insightToneSchema>;

export const insightTitleSchema = z.string().trim().min(1).max(200);
/** Markdown-lite: paragraphs split on blank lines, a paragraph of only `**Header**` is a header. */
export const insightBodySchema = z.string().trim().min(1).max(20_000);
/** One word, shown as a chip, like an email label. */
export const insightTopicSchema = z.string().trim().min(1).max(40);
/** How many days the insight is expected to stay true before it drops to Stale. */
export const insightValidDaysSchema = z.number().int().min(1).max(90);
export const DEFAULT_INSIGHT_VALID_DAYS = 7;

/** The Langy answer an insight was saved from, so "Chat about it" can find its way back. */
export const insightSourceSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});
export type InsightSource = z.infer<typeof insightSourceSchema>;

/** One insight as a reader sees it: the shared record plus that reader's own state. */
export const insightEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tone: insightToneSchema,
  topic: z.string().nullable(),
  validDays: z.number().int(),
  /** The LangWatchQL query behind the insight, its evidence. */
  lwql: z.string().nullable(),
  source: insightSourceSchema.nullable(),
  filedByUserId: z.string().nullable(),
  /** Epoch milliseconds. */
  filedAt: z.number(),
  renewedAt: z.number().nullable(),
  seenAt: z.number().nullable(),
  archivedAt: z.number().nullable(),
  keptAt: z.number().nullable(),
});
export type InsightEntry = z.infer<typeof insightEntrySchema>;

export const insightProjectScopeSchema = z.object({ projectId: z.string().min(1) });

export const fileInsightInputSchema = z.object({
  ...insightProjectScopeSchema.shape,
  title: insightTitleSchema,
  body: insightBodySchema,
  tone: insightToneSchema,
  topic: insightTopicSchema.optional(),
  validDays: insightValidDaysSchema.default(DEFAULT_INSIGHT_VALID_DAYS),
  lwql: z.string().trim().min(1).max(20_000).optional(),
  source: insightSourceSchema.optional(),
});
export type FileInsightInput = z.infer<typeof fileInsightInputSchema>;

export const insightScopeSchema = z.object({
  ...insightProjectScopeSchema.shape,
  insightId: z.string().min(1),
});
export type InsightScope = z.infer<typeof insightScopeSchema>;

/** A folder visit marks what it shows; capped so one call stays one small batch. */
export const markInsightsSeenInputSchema = z.object({
  ...insightProjectScopeSchema.shape,
  insightIds: z.array(z.string().min(1)).min(1).max(200),
});
export type MarkInsightsSeenInput = z.infer<typeof markInsightsSeenInputSchema>;
