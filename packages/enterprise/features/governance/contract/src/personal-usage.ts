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
export type PersonalUsageQueryInput = z.infer<
  typeof personalUsageQueryInputSchema
>;

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
export type PersonalUsageBreakdown = z.infer<
  typeof personalUsageBreakdownSchema
>;

export abstract class GovernancePersonalUsageService {
  abstract summary(
    input: PersonalUsageQueryInput,
  ): Promise<PersonalUsageSummary>;

  abstract dailyBuckets(
    input: PersonalUsageQueryInput,
  ): Promise<PersonalUsageBucket[]>;

  abstract breakdownByModel(
    input: PersonalUsageQueryInput,
    limit?: number,
  ): Promise<PersonalUsageBreakdown[]>;
}
