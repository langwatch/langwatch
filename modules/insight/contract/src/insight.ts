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

/** How an insight was filed: a person saving a Langy answer, or a scheduled run. */
export const INSIGHT_FILED_VIA = ["chat", "run"] as const;
export const insightFiledViaSchema = z.enum(INSIGHT_FILED_VIA);
export type InsightFiledVia = z.infer<typeof insightFiledViaSchema>;

const pointerIdSchema = z.string().min(1).max(200);
const pointerNameSchema = z.string().trim().min(1).max(200);

/**
 * The board and widget an insight came from. Only a pointer: nothing checks that either
 * exists, and the names are kept as filed, so the card still says where it came from once
 * the board or the widget is gone.
 */
export const insightBoardSchema = z.object({
  id: pointerIdSchema,
  name: pointerNameSchema,
  widget: z.object({ id: pointerIdSchema, name: pointerNameSchema }).nullable(),
});
export type InsightBoard = z.infer<typeof insightBoardSchema>;

const MAX_REPLAY_PARAMETERS = 32;
const replayParameterValueSchema = z.union([
  z.string().max(4_000),
  z.number().finite(),
  z.boolean(),
]);

/**
 * The evidence, kept as what to run and never as results: the fixed window the query read
 * and the values in force when the insight was filed. A relative period would slide, and
 * the chart would stop matching the text.
 */
export const insightReplaySchema = z
  .object({
    /** Epoch milliseconds. The window is half-open: `[start, end)`. */
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    /** The datapoint step the query read with, in seconds. */
    granularitySeconds: z.number().int().positive(),
    /** The board's period as it was set ("Last 30 days"), for the line under the chart. */
    period: z.string().trim().min(1).max(80).nullable(),
    /** The query's named parameter values; empty when it takes none. */
    parameters: z
      .record(z.string().min(1).max(64), replayParameterValueSchema)
      .refine((parameters) => Object.keys(parameters).length <= MAX_REPLAY_PARAMETERS, {
        error: `At most ${MAX_REPLAY_PARAMETERS} parameter values are kept with an insight`,
      }),
  })
  .refine(({ start, end }) => end > start, {
    path: ["end"],
    error: "The window must end after it starts",
  });
export type InsightReplay = z.infer<typeof insightReplaySchema>;

/** One insight as its owner sees it: the record plus their own seen, done and kept state. */
export const insightEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tone: insightToneSchema,
  topic: z.string().nullable(),
  validDays: z.number().int(),
  /** The LangWatchQL query behind the insight, its evidence. */
  lwql: z.string().nullable(),
  /** The fixed window and values `lwql` replays with; null when it was filed without one. */
  replay: insightReplaySchema.nullable(),
  source: insightSourceSchema.nullable(),
  board: insightBoardSchema.nullable(),
  filedVia: insightFiledViaSchema,
  /** Whose insight it is: the one person who reads it. Null only where nobody can. */
  ownerUserId: z.string().nullable(),
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

export const fileInsightInputSchema = z
  .object({
    ...insightProjectScopeSchema.shape,
    title: insightTitleSchema,
    body: insightBodySchema,
    tone: insightToneSchema,
    topic: insightTopicSchema.optional(),
    validDays: insightValidDaysSchema.default(DEFAULT_INSIGHT_VALID_DAYS),
    lwql: z.string().trim().min(1).max(20_000).optional(),
    replay: insightReplaySchema.optional(),
    source: insightSourceSchema.optional(),
    board: insightBoardSchema.optional(),
  })
  .refine(({ lwql, replay }) => replay === undefined || lwql !== undefined, {
    path: ["replay"],
    error: "A window needs the query it replays",
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
