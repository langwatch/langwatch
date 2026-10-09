/**
 * Event DATA schemas of the insight pipeline: the portable payloads. The envelopes live in
 * `@langwatch/insight-process`, where the eventing dependency belongs.
 */

import { z } from "zod";

import {
  insightBoardSchema,
  insightFiledViaSchema,
  insightReplaySchema,
  insightSourceSchema,
  insightToneSchema,
} from "./insight.ts";

/**
 * An insight filed for one person, by that person saving a Langy answer or by Langy on a run.
 * `replay`, `board`, `filedVia` and `ownerUserId` came after the first filings, each with a
 * default: an old event reads as no window, no pointer, saved from a chat, owned by its filer.
 */
export const insightFiledEventDataSchema = z.object({
  insightId: z.string().min(1),
  title: z.string(),
  body: z.string(),
  tone: insightToneSchema,
  topic: z.string().nullable(),
  validDays: z.number().int().positive(),
  lwql: z.string().nullable(),
  replay: insightReplaySchema.nullable().default(null),
  source: insightSourceSchema.nullable(),
  board: insightBoardSchema.nullable().default(null),
  filedVia: insightFiledViaSchema.default("chat"),
  /** Whose insight it is. Null only on an event stored before owners: its filer owns it. */
  ownerUserId: z.string().min(1).nullable().default(null),
  /** The person who saved it; null when Langy filed it on a scheduled run. */
  filedByUserId: z.string().nullable(),
});
export type InsightFiledEventData = z.infer<typeof insightFiledEventDataSchema>;

/** The owner's act on their insight: seen, marked done, or kept as still relevant. */
export const insightReaderEventDataSchema = z.object({
  insightId: z.string().min(1),
  userId: z.string().min(1),
});
export type InsightReaderEventData = z.infer<typeof insightReaderEventDataSchema>;
