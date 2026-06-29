import { z } from "zod";

/**
 * Wire schemas for GET /api/me/usage. Fields mirror the
 * PersonalUsageService output (and the `api.user.personalUsage` tRPC
 * payload the /me dashboard consumes) one-to-one, kept camelCase to
 * match that existing surface so the two entrypoints don't drift.
 */

export const meUsageQuerySchema = z.object({
  /** Inclusive window start in epoch ms. Defaults to start-of-month. */
  windowStartMs: z.coerce.number().int().optional(),
  /** Exclusive window end in epoch ms. Defaults to now. */
  windowEndMs: z.coerce.number().int().optional(),
});

const mostUsedModelSchema = z
  .object({ name: z.string(), usagePct: z.number() })
  .nullable();

const summarySchema = z.object({
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  mostUsedModel: mostUsedModelSchema,
});

const bucketSchema = z.object({
  day: z.string(),
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
});

const breakdownSchema = z.object({
  label: z.string(),
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
});

export const meUsageResponseSchema = z.object({
  summary: summarySchema,
  dailyBuckets: z.array(bucketSchema),
  breakdownByModel: z.array(breakdownSchema),
});
