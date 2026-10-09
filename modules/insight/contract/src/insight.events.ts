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
 * An insight filed by a person saving a Langy answer, or by Langy itself. `replay`, `board`
 * and `filedVia` came after the first filings: each has a default, so an event stored
 * without them reads as no window, no pointer and saved from a chat.
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
  /** Null when Langy filed it on a scheduled run. */
  filedByUserId: z.string().nullable(),
});
export type InsightFiledEventData = z.infer<typeof insightFiledEventDataSchema>;

/** One reader's own act on an insight: seen, marked done, or kept as still relevant. */
export const insightReaderEventDataSchema = z.object({
  insightId: z.string().min(1),
  userId: z.string().min(1),
});
export type InsightReaderEventData = z.infer<typeof insightReaderEventDataSchema>;
