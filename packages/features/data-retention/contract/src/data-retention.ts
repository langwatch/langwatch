import { z } from "zod";

export const retentionScopeTypes = ["ORGANIZATION", "TEAM", "PROJECT"] as const;
export const retentionScopeSchema = z.enum(retentionScopeTypes);
export type RetentionScopeType = z.infer<typeof retentionScopeSchema>;

export const scopeAssignmentSchema = z
  .object({
    scopeType: retentionScopeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type ScopeAssignment = z.infer<typeof scopeAssignmentSchema>;

export const retentionCategories = ["traces", "scenarios", "experiments"] as const;
export const retentionCategorySchema = z.enum(retentionCategories);
export type RetentionCategory = z.infer<typeof retentionCategorySchema>;

export const retroactiveMutationProgressSchema = z
  .object({
    mutationId: z.string(),
    table: z.string(),
    isDone: z.boolean(),
    partsToDo: z.number(),
    createTime: z.string(),
    category: retentionCategorySchema.nullable(),
  })
  .strict();
export type RetroactiveMutationProgress = z.infer<
  typeof retroactiveMutationProgressSchema
>;

export type RetentionChangeKind = "expansion" | "contraction" | "noop";

export function classifyRetentionChange(input: {
  current: number;
  next: number;
}): RetentionChangeKind {
  const current = input.current <= 0 ? Number.POSITIVE_INFINITY : input.current;
  const next = input.next <= 0 ? Number.POSITIVE_INFINITY : input.next;

  if (next < current) {
    return "contraction";
  }

  if (next > current) {
    return "expansion";
  }

  return "noop";
}

export const pinSources = ["manual", "share"] as const;
export const pinSourceSchema = z.enum(pinSources);
export type PinSource = z.infer<typeof pinSourceSchema>;

export const pinnedTraceSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    traceId: z.string().min(1),
    userId: z.string().min(1).nullable(),
    source: pinSourceSchema,
    reason: z.string().nullable(),
    createdAt: z.date(),
  })
  .strict();
export type PinnedTrace = z.infer<typeof pinnedTraceSchema>;

export const pinTraceInputSchema = z
  .object({
    projectId: z.string().min(1),
    traceId: z.string().min(1),
    userId: z.string().min(1).nullable().optional(),
    reason: z.string().nullable().optional(),
  })
  .strict();
export type PinTraceInput = z.infer<typeof pinTraceInputSchema>;

export const unpinTraceInputSchema = z
  .object({
    projectId: z.string().min(1),
    traceId: z.string().min(1),
  })
  .strict();
export type UnpinTraceInput = z.infer<typeof unpinTraceInputSchema>;

export const RETENTION_WEEK_DAYS = 7;
export const MIN_RETENTION_DAYS = 35;
export const ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS = 49;
export const PAID_RETENTION_PRESET_DAYS = [35, 63] as const;
export const MAX_RETENTION_DAYS = 65534;
export const INDEFINITE_RETENTION_DAYS = 0;
export const MIGRATION_DEFAULT_RETENTION_DAYS = 308;

/**
 * Boot validates and injects this value. The portable contract never reads
 * process environment state at import time.
 */
export const platformDefaultRetentionDaysSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_RETENTION_DAYS)
  .refine((days) => days % RETENTION_WEEK_DAYS === 0, {
    message: `The platform retention default must be a whole number of weeks (a multiple of ${RETENTION_WEEK_DAYS} days).`,
  });

export const retentionDaysSchema = z
  .number()
  .int()
  .min(MIN_RETENTION_DAYS)
  .max(MAX_RETENTION_DAYS)
  .refine((days) => days % RETENTION_WEEK_DAYS === 0, {
    message: `Retention must be a whole number of weeks (a multiple of ${RETENTION_WEEK_DAYS} days).`,
  })
  .refine(
    (days) =>
      PAID_RETENTION_PRESET_DAYS.includes(
        days as (typeof PAID_RETENTION_PRESET_DAYS)[number],
      ) || days >= ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
    {
      message: `Retention under ${ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS} days is only available as a fixed plan option.`,
    },
  );

export const retentionDaysInputSchema = z.union([
  z.literal(INDEFINITE_RETENTION_DAYS),
  retentionDaysSchema,
]);

export const retroactiveRetentionUpdateInputSchema = z
  .object({
    projectId: z.string().min(1),
    category: retentionCategorySchema,
    newRetentionDays: retentionDaysInputSchema,
  })
  .strict();
export type RetroactiveRetentionUpdateInput = z.infer<
  typeof retroactiveRetentionUpdateInputSchema
>;

export const retroactiveMutationProjectInputSchema = z
  .object({ projectId: z.string().min(1) })
  .strict();
export type RetroactiveMutationProjectInput = z.infer<
  typeof retroactiveMutationProjectInputSchema
>;

export const storageMeterTenantInputSchema = z
  .object({ tenantId: z.string().min(1) })
  .strict();
export type StorageMeterTenantInput = z.infer<typeof storageMeterTenantInputSchema>;

export const storageMeterTenantsInputSchema = z
  .object({ tenantIds: z.array(z.string().min(1)) })
  .strict();
export type StorageMeterTenantsInput = z.infer<typeof storageMeterTenantsInputSchema>;

export const killRetroactiveMutationInputSchema = z
  .object({
    projectId: z.string().min(1),
    mutationId: z.string().min(1),
  })
  .strict();
export type KillRetroactiveMutationInput = z.infer<
  typeof killRetroactiveMutationInputSchema
>;

export const retentionPolicySchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    scopeType: retentionScopeSchema,
    scopeId: z.string().min(1),
    category: retentionCategorySchema,
    retentionDays: retentionDaysInputSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const retentionRowSchema = z
  .object({
    scopeType: retentionScopeSchema,
    scopeId: z.string().min(1),
    category: retentionCategorySchema,
    retentionDays: retentionDaysInputSchema,
  })
  .strict();
export type RetentionRow = z.infer<typeof retentionRowSchema>;

export const resolvedRetentionSchema = z
  .object({
    traces: z.number().int().nonnegative(),
    scenarios: z.number().int().nonnegative(),
    experiments: z.number().int().nonnegative(),
  })
  .strict();
export type ResolvedRetention = z.infer<typeof resolvedRetentionSchema>;

export const projectScopeContextSchema = z
  .object({
    organizationId: z.string().min(1),
    teamId: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();
export type ProjectScopeContext = z.infer<typeof projectScopeContextSchema>;

export function resolveScopeChain(context: ProjectScopeContext): ScopeAssignment[] {
  return [
    { scopeType: "PROJECT", scopeId: context.projectId },
    { scopeType: "TEAM", scopeId: context.teamId },
    { scopeType: "ORGANIZATION", scopeId: context.organizationId },
  ];
}

export function resolveRetention(input: {
  rows: RetentionRow[];
  chain: ScopeAssignment[];
  defaultRetentionDays: number;
}): ResolvedRetention {
  const resolved: ResolvedRetention = {
    traces: input.defaultRetentionDays,
    scenarios: input.defaultRetentionDays,
    experiments: input.defaultRetentionDays,
  };
  for (const category of retentionCategories) {
    const match = input.chain
      .map((scope) =>
        input.rows.find(
          (row) =>
            row.scopeType === scope.scopeType &&
            row.scopeId === scope.scopeId &&
            row.category === category,
        ),
      )
      .find((row) => row !== void 0);

    if (match) {
      resolved[category] = match.retentionDays;
    }
  }
  return resolved;
}
