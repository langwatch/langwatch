import type { Named } from "@langwatch/module";
import { z } from "zod";

const personalUsageWindowSchemaDefinition = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine(({ startMs, endMs }) => endMs > startMs, {
    message: "endMs must be greater than startMs",
    path: ["endMs"],
  });
export interface PersonalUsageWindowSchema extends Named<
  typeof personalUsageWindowSchemaDefinition
> {}
export const personalUsageWindowSchema: PersonalUsageWindowSchema =
  personalUsageWindowSchemaDefinition;
export type PersonalUsageWindow = z.infer<typeof personalUsageWindowSchema>;

const personalUsageQueryInputSchemaDefinition = z
  .object({
    personalProjectId: z.string().min(1),
    window: personalUsageWindowSchema.optional(),
    userId: z.string().min(1).optional(),
    ingestionTenantId: z.string().min(1).optional(),
  })
  .strict();
export interface PersonalUsageQueryInputSchema extends Named<
  typeof personalUsageQueryInputSchemaDefinition
> {}
export const personalUsageQueryInputSchema: PersonalUsageQueryInputSchema =
  personalUsageQueryInputSchemaDefinition;
export type PersonalUsageQueryInput = z.infer<typeof personalUsageQueryInputSchema>;

const personalUsageSummarySchemaDefinition = z
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
export interface PersonalUsageSummarySchema extends Named<
  typeof personalUsageSummarySchemaDefinition
> {}
export const personalUsageSummarySchema: PersonalUsageSummarySchema =
  personalUsageSummarySchemaDefinition;
export type PersonalUsageSummary = z.infer<typeof personalUsageSummarySchema>;

const personalUsageBucketSchemaDefinition = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    spentUsd: z.number(),
    billedUsd: z.number(),
    requests: z.number().int().nonnegative(),
  })
  .strict();
export interface PersonalUsageBucketSchema extends Named<
  typeof personalUsageBucketSchemaDefinition
> {}
export const personalUsageBucketSchema: PersonalUsageBucketSchema =
  personalUsageBucketSchemaDefinition;
export type PersonalUsageBucket = z.infer<typeof personalUsageBucketSchema>;

const personalUsageBreakdownSchemaDefinition = z
  .object({
    label: z.string(),
    spentUsd: z.number(),
    billedUsd: z.number(),
    requests: z.number().int().nonnegative(),
  })
  .strict();
export interface PersonalUsageBreakdownSchema extends Named<
  typeof personalUsageBreakdownSchemaDefinition
> {}
export const personalUsageBreakdownSchema: PersonalUsageBreakdownSchema =
  personalUsageBreakdownSchemaDefinition;
export type PersonalUsageBreakdown = z.infer<typeof personalUsageBreakdownSchema>;

/** The three answers one /me usage screen renders, resolved together. */
const personalUsageRollupSchemaDefinition = z
  .object({
    summary: personalUsageSummarySchema,
    dailyBuckets: z.array(personalUsageBucketSchema),
    breakdownByModel: z.array(personalUsageBreakdownSchema),
  })
  .strict();
export interface PersonalUsageRollupSchema extends Named<
  typeof personalUsageRollupSchemaDefinition
> {}
export const personalUsageRollupSchema: PersonalUsageRollupSchema =
  personalUsageRollupSchemaDefinition;
export type PersonalUsageRollup = z.infer<typeof personalUsageRollupSchema>;

// -- `/api/me/usage`, served by governance at user's path --------------------
// The fields mirror the `governance.personalUsage` tRPC payload one-to-one,
// camelCase included, so the two entrypoints cannot drift.

// Max absolute epoch-ms representable by a JS `Date` (ECMA-262); anything
// beyond becomes `Invalid Date`, so bound the inputs before they reach
// `new Date(...)` downstream.
const MAX_DATE_MS = 8_640_000_000_000_000;
const epochMs = z.coerce.number().int().min(-MAX_DATE_MS).max(MAX_DATE_MS);

const meUsageQuerySchemaDefinition = z
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
export interface MeUsageQuerySchema extends Named<typeof meUsageQuerySchemaDefinition> {}
export const meUsageQuerySchema: MeUsageQuerySchema = meUsageQuerySchemaDefinition;

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

const meUsageResponseSchemaDefinition = z.object({
  summary: meUsageSummarySchema,
  dailyBuckets: z.array(meUsageBucketSchema),
  breakdownByModel: z.array(meUsageBreakdownSchema),
});
export interface MeUsageResponseSchema extends Named<typeof meUsageResponseSchemaDefinition> {}
export const meUsageResponseSchema: MeUsageResponseSchema = meUsageResponseSchemaDefinition;

export type MeUsage = z.infer<typeof meUsageResponseSchema>;

/**
 * The credential `/api/me` resolved, as the mounting process reads it. The
 * key's CLASS is half the decision - a service key belongs to nobody and must
 * not be read as a personal workspace's own legacy key - so it travels whole.
 */
const mePersonalCredentialSchemaDefinition = z.discriminatedUnion("kind", [
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
export interface MePersonalCredentialSchema extends Named<
  typeof mePersonalCredentialSchemaDefinition
> {}
export const mePersonalCredentialSchema: MePersonalCredentialSchema =
  mePersonalCredentialSchemaDefinition;

export type MePersonalCredential = z.infer<typeof mePersonalCredentialSchema>;
