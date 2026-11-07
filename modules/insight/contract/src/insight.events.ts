/**
 * Event DATA schemas of the insight pipeline: the portable payloads. The envelopes live in
 * `@langwatch/insight-process`, where the eventing dependency belongs.
 */

import type { Named } from "@langwatch/module";
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
 * `replay`, `board`, `filedVia`, `ownerUserId` and `findingKey` came later, each with a default:
 * an old event reads as no window, no pointer, saved from a chat, its filer's, with no key.
 */
const insightFiledEventDataSchemaDefinition = z.object({
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
  /** The key a later run matches the same finding by; null when it was saved from a chat. */
  findingKey: z.string().min(1).nullable().default(null),
});
export interface InsightFiledEventDataSchema extends Named<
  typeof insightFiledEventDataSchemaDefinition
> {}
export const insightFiledEventDataSchema: InsightFiledEventDataSchema =
  insightFiledEventDataSchemaDefinition;
export type InsightFiledEventData = z.infer<typeof insightFiledEventDataSchema>;

/**
 * A later run found the insight still true: its words, tone, validity, window and source become
 * the run's; id, title and owner stay; no reader's state moves. A null `tone` (stored before
 * tones renewed) or `source` (a renewal with no conversation) keeps the insight's.
 */
const insightRenewedEventDataSchemaDefinition = z.object({
  insightId: z.string().min(1),
  body: z.string(),
  tone: insightToneSchema.nullable().default(null),
  validDays: z.number().int().positive(),
  /** The window the insight's query replays over from now on; null when it keeps no query. */
  replay: insightReplaySchema.nullable(),
  source: insightSourceSchema.nullable(),
});
export interface InsightRenewedEventDataSchema extends Named<
  typeof insightRenewedEventDataSchemaDefinition
> {}
export const insightRenewedEventDataSchema: InsightRenewedEventDataSchema =
  insightRenewedEventDataSchemaDefinition;
export type InsightRenewedEventData = z.infer<typeof insightRenewedEventDataSchema>;

/** The owner's act on their insight: seen, marked done, or kept as still relevant. */
const insightReaderEventDataSchemaDefinition = z.object({
  insightId: z.string().min(1),
  userId: z.string().min(1),
});
export interface InsightReaderEventDataSchema extends Named<
  typeof insightReaderEventDataSchemaDefinition
> {}
export const insightReaderEventDataSchema: InsightReaderEventDataSchema =
  insightReaderEventDataSchemaDefinition;
export type InsightReaderEventData = z.infer<typeof insightReaderEventDataSchema>;
