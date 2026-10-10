import { evaluatorSchema } from "@langwatch/evaluator-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

export const monitorExecutionModeSchema = z.enum(["ON_MESSAGE", "AS_GUARDRAIL", "MANUALLY"]);
export type MonitorExecutionMode = z.infer<typeof monitorExecutionModeSchema>;

const monitorMappingStateSchemaDefinition = z
  .object({
    mapping: z.record(z.string(), z.unknown()),
    expansions: z.array(z.string()),
  })
  .strict();
export interface MonitorMappingStateSchema extends Named<
  typeof monitorMappingStateSchemaDefinition
> {}
export const monitorMappingStateSchema: MonitorMappingStateSchema =
  monitorMappingStateSchemaDefinition;
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
 * The preconditions the monitor editors write: rule objects, or the legacy
 * `{}` some monitors persisted. Exported for browser wire parsing.
 */
const structuredMonitorPreconditionsSchemaDefinition = z.union([
  z.array(monitorPreconditionSchema),
  z.record(z.string(), z.unknown()),
]);
export interface StructuredMonitorPreconditionsSchema extends Named<
  typeof structuredMonitorPreconditionsSchemaDefinition
> {}
export const structuredMonitorPreconditionsSchema: StructuredMonitorPreconditionsSchema =
  structuredMonitorPreconditionsSchemaDefinition;

/**
 * What a monitor stores: any JSON list, as main's `/api/monitors` accepted, or
 * the legacy `{}`. The evaluation reads the rule objects it understands.
 */
const monitorPreconditionsSchemaDefinition = z.union([
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
export interface MonitorPreconditionsSchema extends Named<
  typeof monitorPreconditionsSchemaDefinition
> {}
export const monitorPreconditionsSchema: MonitorPreconditionsSchema =
  monitorPreconditionsSchemaDefinition;

const monitorSchemaDefinition = z
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
export interface MonitorSchema extends Named<typeof monitorSchemaDefinition> {}
export const monitorSchema: MonitorSchema = monitorSchemaDefinition;
export type Monitor = z.infer<typeof monitorSchema>;

const monitorWithEvaluatorSchemaDefinition = monitorSchema.safeExtend({
  evaluator: evaluatorSchema.nullable(),
});
export interface MonitorWithEvaluatorSchema extends Named<
  typeof monitorWithEvaluatorSchemaDefinition
> {}
export const monitorWithEvaluatorSchema: MonitorWithEvaluatorSchema =
  monitorWithEvaluatorSchemaDefinition;
export type MonitorWithEvaluator = z.infer<typeof monitorWithEvaluatorSchema>;

const monitorSummarySchemaDefinition = z
  .object({
    id: z.string().min(1),
    checkType: z.string().min(1),
    name: z.string().min(1),
    threadIdleTimeout: z.number().int().positive().nullable(),
    evaluator: z.object({ name: z.string() }).nullable(),
  })
  .strict();
export interface MonitorSummarySchema extends Named<typeof monitorSummarySchemaDefinition> {}
export const monitorSummarySchema: MonitorSummarySchema = monitorSummarySchemaDefinition;
export type MonitorSummary = z.infer<typeof monitorSummarySchema>;

const enabledGuardrailMonitorSchemaDefinition = z
  .object({
    id: z.string().min(1),
    evaluatorId: z.string().min(1),
    checkType: z.string().min(1),
    parameters: z.json(),
  })
  .strict();
export interface EnabledGuardrailMonitorSchema extends Named<
  typeof enabledGuardrailMonitorSchemaDefinition
> {}
export const enabledGuardrailMonitorSchema: EnabledGuardrailMonitorSchema =
  enabledGuardrailMonitorSchemaDefinition;
export type EnabledGuardrailMonitor = z.infer<typeof enabledGuardrailMonitorSchema>;

const monitorEnabledGuardrailInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    evaluatorIds: z.array(z.string().min(1)),
  })
  .strict();
export interface MonitorEnabledGuardrailInputSchema extends Named<
  typeof monitorEnabledGuardrailInputSchemaDefinition
> {}
export const monitorEnabledGuardrailInputSchema: MonitorEnabledGuardrailInputSchema =
  monitorEnabledGuardrailInputSchemaDefinition;
export type MonitorEnabledGuardrailInput = z.infer<typeof monitorEnabledGuardrailInputSchema>;

const monitorSettingsSchemaDefinition = z.record(z.string(), z.json());
export interface MonitorSettingsSchema extends Named<typeof monitorSettingsSchemaDefinition> {}
export const monitorSettingsSchema: MonitorSettingsSchema = monitorSettingsSchemaDefinition;

const monitorCreateInputSchemaDefinition = z
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
export interface MonitorCreateInputSchema extends Named<
  typeof monitorCreateInputSchemaDefinition
> {}
export const monitorCreateInputSchema: MonitorCreateInputSchema =
  monitorCreateInputSchemaDefinition;
export type MonitorCreateInput = z.infer<typeof monitorCreateInputSchema>;

const monitorUpdateInputSchemaDefinition = z
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
export interface MonitorUpdateInputSchema extends Named<
  typeof monitorUpdateInputSchemaDefinition
> {}
export const monitorUpdateInputSchema: MonitorUpdateInputSchema =
  monitorUpdateInputSchemaDefinition;
export type MonitorUpdateInput = z.infer<typeof monitorUpdateInputSchema>;

/**
 * Experiment-published monitor. JSON fields preserve workbench state for
 * backward compatibility; only mappings is canonicalized to prevent evaluator
 * crashes.
 */
const monitorExperimentUpsertInputSchemaDefinition = z
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
export interface MonitorExperimentUpsertInputSchema extends Named<
  typeof monitorExperimentUpsertInputSchemaDefinition
> {}
export const monitorExperimentUpsertInputSchema: MonitorExperimentUpsertInputSchema =
  monitorExperimentUpsertInputSchemaDefinition;
export type MonitorExperimentUpsertInput = z.infer<typeof monitorExperimentUpsertInputSchema>;

const monitorToggleInputSchemaDefinition = z
  .object({ id: z.string().min(1), projectId: z.string().min(1), enabled: z.boolean() })
  .strict();
export interface MonitorToggleInputSchema extends Named<
  typeof monitorToggleInputSchemaDefinition
> {}
export const monitorToggleInputSchema: MonitorToggleInputSchema =
  monitorToggleInputSchemaDefinition;
export type MonitorToggleInput = z.infer<typeof monitorToggleInputSchema>;

const monitorIdInputSchemaDefinition = z
  .object({ id: z.string().min(1), projectId: z.string().min(1) })
  .strict();
export interface MonitorIdInputSchema extends Named<typeof monitorIdInputSchemaDefinition> {}
export const monitorIdInputSchema: MonitorIdInputSchema = monitorIdInputSchemaDefinition;
export type MonitorIdInput = z.infer<typeof monitorIdInputSchema>;

const monitorNameAvailabilityInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    checkId: z.string().min(1).optional(),
  })
  .strict();
export interface MonitorNameAvailabilityInputSchema extends Named<
  typeof monitorNameAvailabilityInputSchemaDefinition
> {}
export const monitorNameAvailabilityInputSchema: MonitorNameAvailabilityInputSchema =
  monitorNameAvailabilityInputSchemaDefinition;
export type MonitorNameAvailabilityInput = z.infer<typeof monitorNameAvailabilityInputSchema>;

/**
 * Copies the monitor configuration into another project. The evaluator, when
 * present, is copied by the caller's canonical Evaluator service first and its
 * new id is then supplied here.
 */
const monitorReplicationInputSchemaDefinition = z
  .object({
    sourceMonitorId: z.string().min(1),
    sourceProjectId: z.string().min(1),
    targetProjectId: z.string().min(1),
    evaluatorId: z.string().min(1).nullable(),
  })
  .strict();
export interface MonitorReplicationInputSchema extends Named<
  typeof monitorReplicationInputSchemaDefinition
> {}
export const monitorReplicationInputSchema: MonitorReplicationInputSchema =
  monitorReplicationInputSchemaDefinition;
export type MonitorReplicationInput = z.infer<typeof monitorReplicationInputSchema>;

/**
 * Replicating a monitor between two projects the caller administers, evaluator
 * and backing workflow included. The actor is named because the copied
 * workflow's first saved version is recorded against whoever asked for it.
 */
const monitorCopyInputSchemaDefinition = z
  .object({
    monitorId: z.string().min(1),
    sourceProjectId: z.string().min(1),
    targetProjectId: z.string().min(1),
    actor: z.object({ id: z.string().min(1) }).strict(),
  })
  .strict();
export interface MonitorCopyInputSchema extends Named<typeof monitorCopyInputSchemaDefinition> {}
export const monitorCopyInputSchema: MonitorCopyInputSchema = monitorCopyInputSchemaDefinition;
export type MonitorCopyInput = z.infer<typeof monitorCopyInputSchema>;

/**
 * A partial change to a monitor: every field left out keeps the value the
 * monitor already has, which is the one description of that rule.
 */
const monitorPatchInputSchemaDefinition = z
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
export interface MonitorPatchInputSchema extends Named<typeof monitorPatchInputSchemaDefinition> {}
export const monitorPatchInputSchema: MonitorPatchInputSchema = monitorPatchInputSchemaDefinition;
export type MonitorPatchInput = z.infer<typeof monitorPatchInputSchema>;

/** A check as a caller proposed it, before the monitor holding it is written. */
const monitorRunnableCheckInputSchemaDefinition = z
  .object({ checkType: z.string().min(1), parameters: z.unknown() })
  .strict();
export interface MonitorRunnableCheckInputSchema extends Named<
  typeof monitorRunnableCheckInputSchemaDefinition
> {}
export const monitorRunnableCheckInputSchema: MonitorRunnableCheckInputSchema =
  monitorRunnableCheckInputSchemaDefinition;
export type MonitorRunnableCheckInput = z.infer<typeof monitorRunnableCheckInputSchema>;
