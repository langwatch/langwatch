import type { Named } from "@langwatch/module";
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
const monitorApiProjectInputSchemaDefinition = z.object({ projectId: z.string() });
export interface MonitorApiProjectInputSchema extends Named<
  typeof monitorApiProjectInputSchemaDefinition
> {}
export const monitorApiProjectInputSchema: MonitorApiProjectInputSchema =
  monitorApiProjectInputSchemaDefinition;

/** One monitor inside one project. */
const monitorApiMonitorInputSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
});
export interface MonitorApiMonitorInputSchema extends Named<
  typeof monitorApiMonitorInputSchemaDefinition
> {}
export const monitorApiMonitorInputSchema: MonitorApiMonitorInputSchema =
  monitorApiMonitorInputSchemaDefinition;

const monitorApiToggleInputSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  enabled: z.boolean(),
});
export interface MonitorApiToggleInputSchema extends Named<
  typeof monitorApiToggleInputSchemaDefinition
> {}
export const monitorApiToggleInputSchema: MonitorApiToggleInputSchema =
  monitorApiToggleInputSchemaDefinition;

const monitorApiCopyInputSchemaDefinition = z.object({
  monitorId: z.string(),
  // Target project to replicate into.
  projectId: z.string(),
  // Project the monitor is being copied from.
  sourceProjectId: z.string(),
});
export interface MonitorApiCopyInputSchema extends Named<
  typeof monitorApiCopyInputSchemaDefinition
> {}
export const monitorApiCopyInputSchema: MonitorApiCopyInputSchema =
  monitorApiCopyInputSchemaDefinition;

const monitorApiNameAvailabilityInputSchemaDefinition = z.object({
  projectId: z.string(),
  checkId: z.string().optional(),
  name: z.string(),
});
export interface MonitorApiNameAvailabilityInputSchema extends Named<
  typeof monitorApiNameAvailabilityInputSchemaDefinition
> {}
export const monitorApiNameAvailabilityInputSchema: MonitorApiNameAvailabilityInputSchema =
  monitorApiNameAvailabilityInputSchemaDefinition;

/**
 * The field-mapping blob a monitor carries. Open on purpose: its shape is the
 * evaluator's, which this surface does not know.
 */
const monitorApiMappingsSchemaDefinition = z.object({}).passthrough();
export interface MonitorApiMappingsSchema extends Named<
  typeof monitorApiMappingsSchemaDefinition
> {}
export const monitorApiMappingsSchema: MonitorApiMappingsSchema =
  monitorApiMappingsSchemaDefinition;

/** Creating a monitor. */
const monitorApiCreateInputSchemaDefinition = z.object({
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
export interface MonitorApiCreateInputSchema extends Named<
  typeof monitorApiCreateInputSchemaDefinition
> {}
export const monitorApiCreateInputSchema: MonitorApiCreateInputSchema =
  monitorApiCreateInputSchemaDefinition;

/** Editing a monitor. */
const monitorApiUpdateInputSchemaDefinition = z.object({
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
export interface MonitorApiUpdateInputSchema extends Named<
  typeof monitorApiUpdateInputSchemaDefinition
> {}
export const monitorApiUpdateInputSchema: MonitorApiUpdateInputSchema =
  monitorApiUpdateInputSchemaDefinition;

export type MonitorApiProjectInput = z.infer<typeof monitorApiProjectInputSchema>;
export type MonitorApiMonitorInput = z.infer<typeof monitorApiMonitorInputSchema>;
export type MonitorApiToggleInput = z.infer<typeof monitorApiToggleInputSchema>;
export type MonitorApiCopyInput = z.infer<typeof monitorApiCopyInputSchema>;
export type MonitorApiNameAvailabilityInput = z.infer<typeof monitorApiNameAvailabilityInputSchema>;

/** What `toggle` and `delete` answer with: the write landed. */
const monitorWriteAcknowledgedSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface MonitorWriteAcknowledgedSchema extends Named<
  typeof monitorWriteAcknowledgedSchemaDefinition
> {}
export const monitorWriteAcknowledgedSchema: MonitorWriteAcknowledgedSchema =
  monitorWriteAcknowledgedSchemaDefinition;

/** Whether a proposed monitor name is free in the project. */
const monitorNameAvailabilitySchemaDefinition = z.object({ available: z.boolean() }).strict();
export interface MonitorNameAvailabilitySchema extends Named<
  typeof monitorNameAvailabilitySchemaDefinition
> {}
export const monitorNameAvailabilitySchema: MonitorNameAvailabilitySchema =
  monitorNameAvailabilitySchemaDefinition;
