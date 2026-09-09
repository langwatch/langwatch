/**
 * The inputs and answers the `monitors.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * The precondition parser is the contract's own. It used to be injected by the
 * process so the trace-filter registry could narrow which rules a field
 * accepts; that registry now lives in a browser package no server module may
 * value-import, and every caller passed this schema instead.
 */
import { z } from "zod";
import {
  monitorExecutionModeSchema,
  monitorPreconditionsSchema,
  monitorSettingsSchema,
} from "./monitor.ts";

/** One project. Every project-scoped procedure on the surface takes it. */
export const monitorApiProjectInputSchema = z.object({ projectId: z.string() });

/** One monitor inside one project. */
export const monitorApiMonitorInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
});

export const monitorApiPerformanceInputSchema = z.object({
  projectId: z.string(),
  timeZone: z.string().min(1).max(100).optional(),
});

export const monitorApiToggleInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  enabled: z.boolean(),
});

export const monitorApiCopyInputSchema = z.object({
  monitorId: z.string(),
  // Target project to replicate into.
  projectId: z.string(),
  // Project the monitor is being copied from.
  sourceProjectId: z.string(),
});

export const monitorApiNameAvailabilityInputSchema = z.object({
  projectId: z.string(),
  checkId: z.string().optional(),
  name: z.string(),
});

/**
 * The field-mapping blob a monitor carries. Open on purpose: its shape is the
 * evaluator's, which this surface does not know.
 */
export const monitorApiMappingsSchema = z.object({}).passthrough();

/** Creating a monitor. */
export const monitorApiCreateInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  checkType: z.string(),
  preconditions: monitorPreconditionsSchema,
  settings: monitorSettingsSchema,
  mappings: monitorApiMappingsSchema.optional(),
  sample: z.number().min(0).max(1),
  executionMode: monitorExecutionModeSchema,
  evaluatorId: z.string().min(1).optional(),
  level: z.enum(["trace", "thread"]).optional(), // Evaluation level: trace or thread
  threadIdleTimeout: z.number().int().positive().nullable().optional(), // Seconds to wait after last message before evaluating thread
});

/** Editing a monitor. */
export const monitorApiUpdateInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  checkType: z.string(),
  preconditions: monitorPreconditionsSchema,
  settings: monitorSettingsSchema,
  mappings: monitorApiMappingsSchema,
  sample: z.number().min(0).max(1),
  enabled: z.boolean().optional(),
  executionMode: monitorExecutionModeSchema,
  evaluatorId: z.string().min(1).nullable().optional(),
  level: z.enum(["trace", "thread"]).optional(), // Evaluation level: trace or thread
  threadIdleTimeout: z.number().int().positive().nullable().optional(), // Seconds to wait after last message before evaluating thread
});

export type MonitorApiProjectInput = z.infer<typeof monitorApiProjectInputSchema>;
export type MonitorApiMonitorInput = z.infer<typeof monitorApiMonitorInputSchema>;
export type MonitorApiPerformanceInput = z.infer<typeof monitorApiPerformanceInputSchema>;
export type MonitorApiToggleInput = z.infer<typeof monitorApiToggleInputSchema>;
export type MonitorApiCopyInput = z.infer<typeof monitorApiCopyInputSchema>;
export type MonitorApiNameAvailabilityInput = z.infer<typeof monitorApiNameAvailabilityInputSchema>;

/** What `toggle` and `delete` answer with: the write landed. */
export const monitorWriteAcknowledgedSchema = z.object({ success: z.literal(true) }).strict();

/** Whether a proposed monitor name is free in the project. */
export const monitorNameAvailabilitySchema = z.object({ available: z.boolean() }).strict();
