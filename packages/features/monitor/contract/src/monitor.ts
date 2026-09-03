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
 * The precondition shape a monitor persists.
 *
 * Exported because a process that composes no trace-filter registry parses
 * against this and nothing narrower: which RULES a given FIELD accepts is the
 * registry's answer, and it now lives in a browser package no server module
 * may value-import. Parsing the shape here is what the wire has always
 * required; the field/rule cross-check returns with the registry.
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

export const monitorWithEvaluatorSchema = monitorSchema.extend({
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
 * The monitor an experiment is published as.
 *
 * Keyed by the experiment rather than by a monitor id: `Monitor.experimentId`
 * is unique, so publishing the same experiment twice replaces the row it
 * already owns instead of leaving one monitor behind per save. The slug is the
 * experiment's own and arrives with the input rather than being derived here —
 * the published monitor is that experiment under another name.
 *
 * The three JSON fields arrive unknown because that is what they are: they are
 * read back out of the experiment's stored workbench state, which no schema
 * guards on the way in, and they land in `Json` columns exactly as they arrive.
 * Narrowing them here would turn an experiment that publishes today into one
 * that throws. `mappings` is the single exception — the `{}` shape it can hold
 * crashes the evaluator paths that read it back, so the service canonicalises
 * it the same way `create` and `update` already do.
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
