import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * The account columns every per-call row carries (migration 00136). Blank strings and nulls on
 * rows from before the columns existed and on rows with no account. Percent and instants are only
 * ever what the account itself reported; nothing here is derived from tokens.
 */
const codingAgentAccountColumnsSchemaDefinition = z
  .object({
    accountId: z.string(),
    accountName: z.string(),
    accountSource: z.string(),
    accountUsagePercent: z.number().nullable(),
    accountUsageWindow: z.string(),
    accountUsageResetsAtMs: z.number().nullable(),
    accountUsageReadAtMs: z.number().nullable(),
    accountLimitedUntilMs: z.number().nullable(),
  })
  .strict();
export interface CodingAgentAccountColumnsSchema extends Named<
  typeof codingAgentAccountColumnsSchemaDefinition
> {}
export const codingAgentAccountColumnsSchema: CodingAgentAccountColumnsSchema =
  codingAgentAccountColumnsSchemaDefinition;
export type CodingAgentAccountColumns = z.infer<typeof codingAgentAccountColumnsSchema>;

/** A row with no account: what every row from before the columns reads as. */
export const NO_ACCOUNT_COLUMNS: CodingAgentAccountColumns = Object.freeze({
  accountId: "",
  accountName: "",
  accountSource: "",
  accountUsagePercent: null,
  accountUsageWindow: "",
  accountUsageResetsAtMs: null,
  accountUsageReadAtMs: null,
  accountLimitedUntilMs: null,
});

/** The newest usage the account reported. A field it never reported stays null. */
const codingAgentAccountReadingSchemaDefinition = z
  .object({
    percent: z.number().nullable(),
    window: z.string().nullable(),
    resetsAtMs: z.number().nullable(),
    readAtMs: z.number().nullable(),
    limitedUntilMs: z.number().nullable(),
  })
  .strict();
export interface CodingAgentAccountReadingSchema extends Named<
  typeof codingAgentAccountReadingSchemaDefinition
> {}
export const codingAgentAccountReadingSchema: CodingAgentAccountReadingSchema =
  codingAgentAccountReadingSchemaDefinition;
export type CodingAgentAccountReading = z.infer<typeof codingAgentAccountReadingSchema>;

/** One UTC day of an account's model calls. Cost is null when the viewer may not see costs. */
const codingAgentAccountDaySchemaDefinition = z
  .object({
    day: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    costUsd: z.number().nullable(),
  })
  .strict();
export interface CodingAgentAccountDaySchema extends Named<
  typeof codingAgentAccountDaySchemaDefinition
> {}
export const codingAgentAccountDaySchema: CodingAgentAccountDaySchema =
  codingAgentAccountDaySchemaDefinition;
export type CodingAgentAccountDay = z.infer<typeof codingAgentAccountDaySchema>;

/** One subscription account over the week: what its sessions spent and what it last reported. */
const codingAgentAccountBurndownSchemaDefinition = z
  .object({
    accountId: z.string(),
    name: z.string(),
    source: z.string().nullable(),
    agents: z.array(z.string()),
    topModels: z.array(z.string()),
    days: z.array(codingAgentAccountDaySchema),
    totals: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheReadTokens: z.number(),
        cacheWriteTokens: z.number(),
        totalTokens: z.number(),
        costUsd: z.number().nullable(),
      })
      .strict(),
    reading: codingAgentAccountReadingSchema.nullable(),
    rateLimitEvents: z.number(),
  })
  .strict();
export interface CodingAgentAccountBurndownSchema extends Named<
  typeof codingAgentAccountBurndownSchemaDefinition
> {}
export const codingAgentAccountBurndownSchema: CodingAgentAccountBurndownSchema =
  codingAgentAccountBurndownSchemaDefinition;
export type CodingAgentAccountBurndown = z.infer<typeof codingAgentAccountBurndownSchema>;

/** The week's accounts for one project, sorted by account name. */
const codingAgentAccountBurndownPageSchemaDefinition = z
  .object({
    accounts: z.array(codingAgentAccountBurndownSchema),
  })
  .strict();
export interface CodingAgentAccountBurndownPageSchema extends Named<
  typeof codingAgentAccountBurndownPageSchemaDefinition
> {}
export const codingAgentAccountBurndownPageSchema: CodingAgentAccountBurndownPageSchema =
  codingAgentAccountBurndownPageSchemaDefinition;
export type CodingAgentAccountBurndownPage = z.infer<typeof codingAgentAccountBurndownPageSchema>;
