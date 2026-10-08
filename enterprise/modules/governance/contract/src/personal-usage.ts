import { z } from "zod";

export const personalUsageWindowSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine(({ startMs, endMs }) => endMs > startMs, {
    message: "endMs must be greater than startMs",
    path: ["endMs"],
  });
export type PersonalUsageWindow = z.infer<typeof personalUsageWindowSchema>;

export const personalUsageQueryInputSchema = z
  .object({
    personalProjectId: z.string().min(1),
    window: personalUsageWindowSchema.optional(),
    userId: z.string().min(1).optional(),
    ingestionTenantId: z.string().min(1).optional(),
  })
  .strict();
export type PersonalUsageQueryInput = z.infer<typeof personalUsageQueryInputSchema>;

export const personalUsageSummarySchema = z
  .object({
    spentUsd: z.number(),
    billedUsd: z.number(),
    requests: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    mostUsedModel: z
      .object({
        name: z.string(),
        usagePct: z.number().int().min(0).max(100),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PersonalUsageSummary = z.infer<typeof personalUsageSummarySchema>;

export const personalUsageBucketSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    spentUsd: z.number(),
    billedUsd: z.number(),
    requests: z.number().int().nonnegative(),
  })
  .strict();
export type PersonalUsageBucket = z.infer<typeof personalUsageBucketSchema>;

export const personalUsageBreakdownSchema = z
  .object({
    label: z.string(),
    spentUsd: z.number(),
    billedUsd: z.number(),
    requests: z.number().int().nonnegative(),
  })
  .strict();
export type PersonalUsageBreakdown = z.infer<typeof personalUsageBreakdownSchema>;

/** The three answers one /me usage screen renders, resolved together. */
export const personalUsageRollupSchema = z
  .object({
    summary: personalUsageSummarySchema,
    dailyBuckets: z.array(personalUsageBucketSchema),
    breakdownByModel: z.array(personalUsageBreakdownSchema),
  })
  .strict();
export type PersonalUsageRollup = z.infer<typeof personalUsageRollupSchema>;

// -- `/api/me/usage`, served by governance at user's path --------------------
// The fields mirror the `governance.personalUsage` tRPC payload one-to-one,
// camelCase included, so the two entrypoints cannot drift.

// Max absolute epoch-ms representable by a JS `Date` (ECMA-262); anything
// beyond becomes `Invalid Date`, so bound the inputs before they reach
// `new Date(...)` downstream.
const MAX_DATE_MS = 8_640_000_000_000_000;
const epochMs = z.coerce.number().int().min(-MAX_DATE_MS).max(MAX_DATE_MS);

export const meUsageQuerySchema = z
  .object({
    /** Inclusive window start in epoch ms. Defaults to start-of-month. */
    windowStartMs: epochMs.optional(),
    /** Exclusive window end in epoch ms. Defaults to now. */
    windowEndMs: epochMs.optional(),
  })
  // A half-specified window is ambiguous - require both bounds or neither,
  // rather than silently dropping a lone bound and returning the default month.
  .refine((q) => (q.windowStartMs === undefined) === (q.windowEndMs === undefined), {
    message:
      "windowStartMs and windowEndMs must be provided together (or both omitted for the current month).",
  })
  .refine(
    (q) =>
      q.windowStartMs === undefined ||
      q.windowEndMs === undefined ||
      q.windowStartMs < q.windowEndMs,
    { message: "windowStartMs must be before windowEndMs." },
  );

const mostUsedModelSchema = z.object({ name: z.string(), usagePct: z.number() }).nullable();

const meUsageSummarySchema = z.object({
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  mostUsedModel: mostUsedModelSchema,
});

const meUsageBucketSchema = z.object({
  day: z.string(),
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
});

const meUsageBreakdownSchema = z.object({
  label: z.string(),
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
});

export const meUsageResponseSchema = z.object({
  summary: meUsageSummarySchema,
  dailyBuckets: z.array(meUsageBucketSchema),
  breakdownByModel: z.array(meUsageBreakdownSchema),
});

export type MeUsage = z.infer<typeof meUsageResponseSchema>;

/**
 * The credential `/api/me` resolved, as the mounting process reads it. The
 * key's CLASS is half the decision - a service key belongs to nobody and must
 * not be read as a personal workspace's own legacy key - so it travels whole.
 */
export const mePersonalCredentialSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("apiKey"),
    userId: z.string().nullable(),
    organizationId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("cliAccessToken"),
    userId: z.string(),
    organizationId: z.string(),
  }),
  z.object({ kind: z.literal("legacyProjectKey") }),
]);

export type MePersonalCredential = z.infer<typeof mePersonalCredentialSchema>;
