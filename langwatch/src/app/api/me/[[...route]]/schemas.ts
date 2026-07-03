import { z } from "zod";

/**
 * Wire schemas for GET /api/me/usage. Fields mirror the
 * PersonalUsageService output (and the `api.user.personalUsage` tRPC
 * payload the /me dashboard consumes) one-to-one, kept camelCase to
 * match that existing surface so the two entrypoints don't drift.
 */

// Max absolute epoch-ms representable by a JS `Date` (ECMA-262); anything
// beyond becomes `Invalid Date`, so bound the inputs before they reach
// `new Date(...)` in the route handler.
const MAX_DATE_MS = 8_640_000_000_000_000;
const epochMs = z.coerce.number().int().min(-MAX_DATE_MS).max(MAX_DATE_MS);

export const meUsageQuerySchema = z
  .object({
    /** Inclusive window start in epoch ms. Defaults to start-of-month. */
    windowStartMs: epochMs.optional(),
    /** Exclusive window end in epoch ms. Defaults to now. */
    windowEndMs: epochMs.optional(),
  })
  // A half-specified window is ambiguous — require both bounds or neither,
  // rather than silently dropping a lone bound and returning the default month.
  .refine(
    (q) => (q.windowStartMs === undefined) === (q.windowEndMs === undefined),
    {
      message:
        "windowStartMs and windowEndMs must be provided together (or both omitted for the current month).",
    },
  )
  .refine(
    (q) =>
      q.windowStartMs === undefined ||
      q.windowEndMs === undefined ||
      q.windowStartMs < q.windowEndMs,
    { message: "windowStartMs must be before windowEndMs." },
  );

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

const categoryBreakdownSchema = z.object({
  category: z.string(),
  costUsd: z.number(),
  tokens: z.number(),
});

export const meUsageResponseSchema = z.object({
  summary: summarySchema,
  dailyBuckets: z.array(bucketSchema),
  breakdownByModel: z.array(breakdownSchema),
  breakdownByCategory: z.array(categoryBreakdownSchema),
});
