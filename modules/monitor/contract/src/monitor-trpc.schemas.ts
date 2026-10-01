/**
 * Input/answer schemas for monitors.* tRPC surface. Defined in contract so wire shape
 * is consistent across client/server. Precondition parser moved here; formerly injected
 * to tie with trace-filter registry (now in browser package server can't import).
 */
import { z } from "zod";

import {
  monitorExecutionModeSchema,
  monitorSettingsSchema,
  structuredMonitorPreconditionsSchema,
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
  preconditions: structuredMonitorPreconditionsSchema,
  settings: monitorSettingsSchema,
  mappings: monitorApiMappingsSchema.optional(),
  sample: z.number().min(0).max(1),
  executionMode: monitorExecutionModeSchema,
  evaluatorId: z.string().min(1).optional(),
  level: z.enum(["trace", "thread"]).optional(), // Trace or thread
  threadIdleTimeout: z.number().int().positive().nullable().optional(), // Idle timeout (seconds)
});

/** Editing a monitor. */
export const monitorApiUpdateInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  checkType: z.string(),
  preconditions: structuredMonitorPreconditionsSchema,
  settings: monitorSettingsSchema,
  mappings: monitorApiMappingsSchema,
  sample: z.number().min(0).max(1),
  enabled: z.boolean().optional(),
  executionMode: monitorExecutionModeSchema,
  evaluatorId: z.string().min(1).nullable().optional(),
  level: z.enum(["trace", "thread"]).optional(), // Trace or thread
  threadIdleTimeout: z.number().int().positive().nullable().optional(), // Idle timeout (seconds)
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
