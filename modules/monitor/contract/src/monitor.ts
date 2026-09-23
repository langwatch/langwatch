import { evaluatorSchema } from "@langwatch/evaluator-contract";
import { z } from "zod";

export const monitorExecutionModeSchema = z.enum(["ON_MESSAGE", "AS_GUARDRAIL", "MANUALLY"]);
export type MonitorExecutionMode = z.infer<typeof monitorExecutionModeSchema>;

export const monitorMappingStateSchema = z
  .object({
    mapping: z.record(z.string(), z.unknown()),
    expansions: z.array(z.string()),
  })
  .strict();
export type MonitorMappingState = z.infer<typeof monitorMappingStateSchema>;

/** Legacy `{}`/malformed mappings are persisted as a safe empty mapping. */
export const monitorMappingsInputSchema = z.preprocess((value) => {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "mapping" in value) {
    return value;
  }
  return { mapping: {}, expansions: [] };
}, monitorMappingStateSchema);

const monitorPreconditionSchema = z
  .object({
    field: z.string().min(1),
    rule: z.string().min(1),
    value: z.string().min(1),
    key: z.string().optional(),
    subkey: z.string().optional(),
  })
  .strict();
/**
 * Exported to support wire parsing in browser packages that can't import the
 * trace-filter registry.
 */
export const monitorPreconditionsSchema = z.union([
  z.array(monitorPreconditionSchema),
  // Some legacy monitors persisted `{}` rather than the newer array form.
  z.record(z.string(), z.unknown()),
]);

export const monitorSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    experimentId: z.string().nullable(),
    evaluatorId: z.string().nullable(),
    checkType: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    executionMode: monitorExecutionModeSchema,
    enabled: z.boolean(),
    preconditions: monitorPreconditionsSchema,
    parameters: z.json(),
    mappings: monitorMappingStateSchema.nullable(),
    sample: z.number().min(0).max(1),
    level: z.string(),
    threadIdleTimeout: z.number().int().positive().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Monitor = z.infer<typeof monitorSchema>;

export const monitorWithEvaluatorSchema = monitorSchema.safeExtend({
  evaluator: evaluatorSchema.nullable(),
});
export type MonitorWithEvaluator = z.infer<typeof monitorWithEvaluatorSchema>;

export const monitorSummarySchema = z
  .object({
    id: z.string().min(1),
    checkType: z.string().min(1),
    name: z.string().min(1),
    threadIdleTimeout: z.number().int().positive().nullable(),
    evaluator: z.object({ name: z.string() }).nullable(),
  })
  .strict();
export type MonitorSummary = z.infer<typeof monitorSummarySchema>;

export const enabledGuardrailMonitorSchema = z
  .object({
    id: z.string().min(1),
    evaluatorId: z.string().min(1),
    checkType: z.string().min(1),
    parameters: z.json(),
  })
  .strict();
export type EnabledGuardrailMonitor = z.infer<typeof enabledGuardrailMonitorSchema>;

export const monitorEnabledGuardrailInputSchema = z
  .object({
    projectId: z.string().min(1),
    evaluatorIds: z.array(z.string().min(1)),
  })
  .strict();
export type MonitorEnabledGuardrailInput = z.infer<typeof monitorEnabledGuardrailInputSchema>;

export const monitorSettingsSchema = z.record(z.string(), z.json());

export const monitorCreateInputSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    checkType: z.string().min(1),
    preconditions: monitorPreconditionsSchema,
    parameters: monitorSettingsSchema,
    mappings: z.unknown().optional(),
    sample: z.number().min(0).max(1),
    executionMode: monitorExecutionModeSchema,
    evaluatorId: z.string().min(1).optional(),
    level: z.enum(["trace", "thread"]).optional(),
    threadIdleTimeout: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type MonitorCreateInput = z.infer<typeof monitorCreateInputSchema>;

export const monitorUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    checkType: z.string().min(1),
    preconditions: monitorPreconditionsSchema,
    parameters: monitorSettingsSchema,
    mappings: z.unknown(),
    sample: z.number().min(0).max(1),
    enabled: z.boolean().optional(),
    executionMode: monitorExecutionModeSchema,
    evaluatorId: z.string().min(1).nullable().optional(),
    level: z.enum(["trace", "thread"]).optional(),
    threadIdleTimeout: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type MonitorUpdateInput = z.infer<typeof monitorUpdateInputSchema>;

/**
 * Experiment-published monitor. JSON fields preserve workbench state for
 * backward compatibility; only mappings is canonicalized to prevent evaluator
 * crashes.
 */
export const monitorExperimentUpsertInputSchema = z
  .object({
    projectId: z.string().min(1),
    experimentId: z.string().min(1),
    name: z.string().min(1),
    checkType: z.string().min(1),
    slug: z.string().min(1),
    preconditions: z.unknown(),
    parameters: z.unknown(),
    mappings: z.unknown(),
    sample: z.number().min(0).max(1),
    enabled: z.boolean(),
    executionMode: z.string().min(1),
  })
  .strict();
export type MonitorExperimentUpsertInput = z.infer<typeof monitorExperimentUpsertInputSchema>;

export const monitorToggleInputSchema = z
  .object({ id: z.string().min(1), projectId: z.string().min(1), enabled: z.boolean() })
  .strict();
export type MonitorToggleInput = z.infer<typeof monitorToggleInputSchema>;

export const monitorIdInputSchema = z
  .object({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export type MonitorIdInput = z.infer<typeof monitorIdInputSchema>;

export const monitorNameAvailabilityInputSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    checkId: z.string().min(1).optional(),
  })
  .strict();
export type MonitorNameAvailabilityInput = z.infer<typeof monitorNameAvailabilityInputSchema>;

/**
 * Copies the monitor configuration into another project. The evaluator, when
 * present, is copied by the caller's canonical Evaluator service first and its
 * new id is then supplied here.
 */
export const monitorReplicationInputSchema = z
  .object({
    sourceMonitorId: z.string().min(1),
    sourceProjectId: z.string().min(1),
    targetProjectId: z.string().min(1),
    evaluatorId: z.string().min(1).nullable(),
  })
  .strict();
export type MonitorReplicationInput = z.infer<typeof monitorReplicationInputSchema>;

/**
 * Replicating a monitor between two projects the caller administers, evaluator
 * and backing workflow included. The actor is named because the copied
 * workflow's first saved version is recorded against whoever asked for it.
 */
export const monitorCopyInputSchema = z
  .object({
    monitorId: z.string().min(1),
    sourceProjectId: z.string().min(1),
    targetProjectId: z.string().min(1),
    actor: z.object({ id: z.string().min(1) }).strict(),
  })
  .strict();
export type MonitorCopyInput = z.infer<typeof monitorCopyInputSchema>;

/**
 * A partial change to a monitor: every field left out keeps the value the
 * monitor already has, which is the one description of that rule.
 */
export const monitorPatchInputSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    changes: z
      .object({
        name: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
        checkType: z.string().min(1).optional(),
        executionMode: monitorExecutionModeSchema.optional(),
        preconditions: monitorPreconditionsSchema.optional(),
        parameters: monitorSettingsSchema.optional(),
        mappings: z.unknown().optional(),
        sample: z.number().min(0).max(1).optional(),
        evaluatorId: z.string().min(1).nullable().optional(),
        level: z.enum(["trace", "thread"]).optional(),
        threadIdleTimeout: z.number().int().positive().nullable().optional(),
      })
      .strict(),
  })
  .strict();
export type MonitorPatchInput = z.infer<typeof monitorPatchInputSchema>;

/** The seven-day trend window, in the reader's own time zone. */
export const monitorPerformanceInputSchema = z
  .object({
    projectId: z.string().min(1),
    timeZone: z.string().min(1).max(100).optional(),
    actor: z.object({ id: z.string().min(1) }).strict(),
  })
  .strict();
export type MonitorPerformanceInput = z.infer<typeof monitorPerformanceInputSchema>;

/** A check as a caller proposed it, before the monitor holding it is written. */
export const monitorRunnableCheckInputSchema = z
  .object({ checkType: z.string().min(1), parameters: z.unknown() })
  .strict();
export type MonitorRunnableCheckInput = z.infer<typeof monitorRunnableCheckInputSchema>;
